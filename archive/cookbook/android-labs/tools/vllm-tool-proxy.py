#!/usr/bin/env python3
"""
vLLM Tool Call Proxy  (v4.0)

Fixes GPT-OSS-120B parser issues:

GPT-OSS-120B has native OpenAI-format tool calling. Retained safety nets:
3. Post-processes to extract tool calls from content if output as text
   (<tools> JSON, bare JSON, or multi-line JSON).
4. Safety net: Aborts after MAX_TOOL_CALLS (20) to prevent runaway loops.

CHANGES:
- v2.1 (2026-02-09): Fixed loop issue - only force 'required' on first turn
- v2.1: Added MAX_TOOL_CALLS limit as safety net
- v2.0: Added multi-line JSON parsing for bare tool calls

Point OpenClaw to this proxy instead of directly to vLLM.
"""
import argparse
import json
import logging
import re
import uuid
from flask import Flask, request, Response
import requests

app = Flask(__name__)
logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s: %(message)s')
logger = logging.getLogger(__name__)

VLLM_URL = 'http://192.168.0.143:8000'

# Max tool calls per conversation - safety net for loops
# Count tool results in messages and abort if too many
MAX_TOOL_CALLS = 20

TOOLS_REGEX = re.compile(r'<tools>(.*?)</tools>', re.DOTALL)



def has_tools(body):
    return body and body.get('tools')






def count_tool_results(messages):
    """Count tool result messages in the conversation."""
    if not messages:
        return 0
    count = 0
    for msg in messages:
        role = msg.get('role', '')
        if role == 'tool' or msg.get('tool_call_id'):
            count += 1
    return count




def check_tool_loop(body):
    """Check if we've hit the max tool calls limit.
    Returns error response if limit exceeded, None otherwise."""
    messages = body.get('messages', [])
    tool_count = count_tool_results(messages)
    
    if tool_count >= MAX_TOOL_CALLS:
        logger.warning(f'Tool call limit exceeded: {tool_count} >= {MAX_TOOL_CALLS}')
        return {
            'id': 'chatcmpl-loop-abort',
            'object': 'chat.completion',
            'created': 0,
            'model': body.get('model', 'unknown'),
            'choices': [{
                'index': 0,
                'message': {
                    'role': 'assistant',
                    'content': f'[Loop detected: {tool_count} tool calls exceeded limit of {MAX_TOOL_CALLS}. Task should be complete - please provide final response.]'
                },
                'finish_reason': 'stop'
            }]
        }
    return None




def parse_single_tool_call(text):
    """Try to parse a single tool call from text. Returns dict or None."""
    text = text.strip()
    if not text:
        return None
    try:
        call = json.loads(text)
        if isinstance(call, dict) and 'name' in call:
            args = call.get('arguments', {})
            if isinstance(args, dict):
                args = json.dumps(args)
            return {
                'id': f'chatcmpl-tool-{uuid.uuid4().hex[:16]}',
                'type': 'function',
                'function': {'name': call['name'], 'arguments': args}
            }
    except (json.JSONDecodeError, ValueError):
        pass
    return None


def clean_response_for_openclaw(resp_json):
    """Strip vLLM and GPT-OSS specific fields for clean OpenAI format."""
    try:
        # Clean top-level vLLM-specific fields
        for field in ["prompt_logprobs", "prompt_token_ids", "kv_transfer_params",
                       "service_tier", "system_fingerprint"]:
            resp_json.pop(field, None)

        for choice in resp_json.get("choices", []):
            # Clean choice-level vLLM fields
            for field in ["stop_reason", "token_ids"]:
                choice.pop(field, None)

            msg = choice.get("message", {})
            # Remove fields OpenClaw doesn't expect
            for field in ["reasoning", "reasoning_content", "refusal",
                          "annotations", "audio", "function_call"]:
                msg.pop(field, None)
            # Ensure tool_calls is absent (not empty list) when no tools
            if not msg.get("tool_calls"):
                msg.pop("tool_calls", None)

        # Clean usage fields
        usage = resp_json.get("usage", {})
        if usage:
            usage.pop("prompt_tokens_details", None)
    except Exception as e:
        # Sanitize exception to prevent PII leakage
        error_msg = str(e)
        error_msg = re.sub(r'<PII_\w+_\w{12}>', '[REDACTED]', error_msg)
        error_msg = re.sub(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b', '[EMAIL]', error_msg)
        logger.error(f"Error cleaning response: {error_msg}")



def extract_tools_from_content(response_json):
    """Post-process: if tool_calls is empty but content has tool JSON, fix it."""
    try:
        choices = response_json.get('choices', [])
        for choice in choices:
            msg = choice.get('message', {})
            content = msg.get('content', '') or ''
            tool_calls = msg.get('tool_calls') or []

            if tool_calls or not content.strip():
                continue

            extracted_calls = []

            # Try <tools> tag extraction first
            matches = TOOLS_REGEX.findall(content)
            if matches:
                for match in matches:
                    for line in match.strip().split('\n'):
                        call = parse_single_tool_call(line)
                        if call:
                            extracted_calls.append(call)

            # Try bare JSON extraction - single object first
            if not extracted_calls:
                stripped = content.strip()
                call = parse_single_tool_call(stripped)
                if call:
                    extracted_calls.append(call)

            # NEW in v2: Try multi-line JSON extraction
            # Model sometimes outputs multiple tool calls on separate lines
            if not extracted_calls:
                lines = content.strip().split('\n')
                for line in lines:
                    call = parse_single_tool_call(line)
                    if call:
                        extracted_calls.append(call)

            if extracted_calls:
                logger.info(f'Extracted {len(extracted_calls)} tool call(s) from content')
                # Clean the content - remove extracted JSON
                cleaned = TOOLS_REGEX.sub('', content).strip()
                # If content is just JSON, clear it
                remaining_lines = []
                for line in cleaned.split('\n'):
                    if not parse_single_tool_call(line):
                        remaining_lines.append(line)
                cleaned = '\n'.join(remaining_lines).strip()
                
                msg['content'] = cleaned if cleaned else None
                msg['tool_calls'] = extracted_calls
                choice['finish_reason'] = 'tool_calls'
    except Exception as e:
        # Sanitize exception to prevent PII leakage
        error_msg = str(e)
        error_msg = re.sub(r'<PII_\w+_\w{12}>', '[REDACTED]', error_msg)
        error_msg = re.sub(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b', '[EMAIL]', error_msg)
        logger.error(f'Error in post-processing: {error_msg}')


@app.route('/v1/<path:path>', methods=['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'])
def proxy(path):
    url = f'{VLLM_URL}/v1/{path}'

    if request.method == 'OPTIONS':
        return Response('', status=204)

    if path not in ('chat/completions', 'responses'):
        return forward_request(url)

    try:
        body = request.get_json()
    except Exception:
        body = None

    # Check for tool call loop
    if body and has_tools(body):
        loop_response = check_tool_loop(body)
        if loop_response:
            return Response(json.dumps(loop_response), status=200, mimetype='application/json')

    # Force non-streaming when tools are present so post-processor can extract tool calls from text
    if body and has_tools(body) and body.get("stream", False):
        logger.info("Forcing non-streaming for tool call post-processing")
        body["stream"] = False
        body.pop("stream_options", None)
    is_streaming = body.get("stream", False) if body else False
    # Always strip stream_options when stream is false (vLLM 0.14+ rejects this combo)
    if body and not body.get("stream", False) and "stream_options" in body:
        logger.info("Stripping stream_options from non-streaming request")
        body.pop("stream_options", None)
    headers = {k: v for k, v in request.headers if k.lower() not in ('host', 'content-length')}

    if is_streaming:
        return stream_response(url, headers, body)
    else:
        return forward_with_body_and_fix(url, headers, body)


def forward_request(url):
    headers = {k: v for k, v in request.headers if k.lower() not in ('host', 'content-length')}
    try:
        resp = requests.request(
            method=request.method, url=url, headers=headers,
            data=request.get_data(), stream=True, timeout=300
        )
        excluded = {'content-encoding', 'transfer-encoding', 'content-length'}
        resp_headers = {k: v for k, v in resp.headers.items() if k.lower() not in excluded}
        return Response(resp.iter_content(chunk_size=1024), status=resp.status_code, headers=resp_headers)
    except Exception as e:
        # Sanitize exception to prevent PII leakage
        error_msg = str(e)
        error_msg = re.sub(r'<PII_\w+_\w{12}>', '[REDACTED]', error_msg)
        error_msg = re.sub(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b', '[EMAIL]', error_msg)
        logger.error(f'Forward error: {error_msg}')
        return Response(json.dumps({'error': 'Proxy forwarding failed'}), status=502, mimetype='application/json')


def forward_with_body_and_fix(url, headers, body):
    try:
        resp = requests.post(url, headers=headers, json=body, timeout=300)
        try:
            resp_json = resp.json()
            if body and has_tools(body): extract_tools_from_content(resp_json)  # Only when tools present
            clean_response_for_openclaw(resp_json)
            logger.info("RESPONSE: " + json.dumps({"c": str((resp_json.get("choices") or [{}])[0].get("message",{}).get("content"))[:200], "r": str((resp_json.get("choices") or [{}])[0].get("message",{}).get("reasoning",""))[:100], "f": (resp_json.get("choices") or [{}])[0].get("finish_reason"), "s": resp.status_code}))
            return Response(
                json.dumps(resp_json),
                status=resp.status_code,
                mimetype='application/json'
            )
        except Exception:
            return Response(resp.content, status=resp.status_code)
    except Exception as e:
        # Sanitize exception to prevent PII leakage
        error_msg = str(e)
        error_msg = re.sub(r'<PII_\w+_\w{12}>', '[REDACTED]', error_msg)
        error_msg = re.sub(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b', '[EMAIL]', error_msg)
        logger.error(f'Forward error: {error_msg}')
        return Response(json.dumps({'error': 'Proxy forwarding failed'}), status=502, mimetype='application/json')


def stream_response(url, headers, body):
    def generate():
        try:
            with requests.post(url, headers=headers, json=body, stream=True, timeout=300) as resp:
                for chunk in resp.iter_content(chunk_size=None):
                    if chunk:
                        yield chunk
        except Exception as e:
            # Sanitize exception to prevent PII leakage
            error_msg = str(e)
            error_msg = re.sub(r'<PII_\w+_\w{12}>', '[REDACTED]', error_msg)
            error_msg = re.sub(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b', '[EMAIL]', error_msg)
            logger.error(f'Stream error: {error_msg}')
            error_data = json.dumps({"error": "Internal proxy error"})
            yield f'data: {error_data}\n\n'
    return Response(generate(), mimetype='text/event-stream')


@app.route('/health')
def health():
    return {'status': 'ok', 'vllm_url': VLLM_URL, 'version': 'v4'}


@app.route('/')
def root():
    return {
        'service': 'vLLM Tool Call Proxy ',
        'version': 'v4',
        'vllm_url': VLLM_URL,
        'features': [
            'force tool_choice=required when tools present',
            'extract tool calls from <tools> tags in content',
            'extract tool calls from bare JSON in content',
            'extract tool calls from multi-line JSON in content',
            'force non-streaming when tools present'
        ]
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8003)
    parser.add_argument('--vllm-url', type=str, default='http://192.168.0.143:8000')
    parser.add_argument('--host', type=str, default='0.0.0.0')
    args = parser.parse_args()
    VLLM_URL = args.vllm_url
    logger.info(f'Starting vLLM Tool Call Proxy v4 on {args.host}:{args.port} -> {VLLM_URL}')
    app.run(host=args.host, port=args.port, threaded=True)

#!/usr/bin/env python3
"""
M3 Privacy Shield - OpenAI-compatible proxy with PII filtering

Routes OpenAI API calls through local PII detection (Presidio) before
forwarding to your local vLLM instance. Strips sensitive data, gets
response, restores context.

Drop-in replacement: just change your base URL.
"""
import os
import json
import logging
import hashlib
from typing import Dict, Tuple, Optional
from flask import Flask, request, Response, jsonify
import requests

# PII detection
from shield import shield, unshield

app = Flask(__name__)
logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger(__name__)

# Config from environment
LOCAL_LLM_URL = os.getenv('LOCAL_LLM_URL', 'http://192.168.0.143:8000')
PRIVACY_MODE = os.getenv('PRIVACY_MODE', 'on').lower() == 'on'
MIN_PII_SCORE = float(os.getenv('MIN_PII_SCORE', '0.4'))

# Session storage for multi-turn conversations (mapping restoration)
# In production, use Redis or similar
_sessions: Dict[str, Dict[str, str]] = {}

# Stats
stats = {
    'requests': 0,
    'blocked': 0,
    'proxied': 0,
    'pii_detections': 0,
    'entities_stripped': 0
}


def get_session_key(messages: list) -> str:
    """Generate a session key from conversation history."""
    # Hash first few messages to identify the conversation
    if not messages:
        return 'default'
    content = json.dumps(messages[:3], sort_keys=True)
    return hashlib.sha256(content.encode()).hexdigest()[:16]


def anonymize_messages(messages: list, session_key: str) -> Tuple[list, int]:
    """
    Anonymize PII in all message contents.
    Returns anonymized messages and count of entities stripped.
    """
    if session_key not in _sessions:
        _sessions[session_key] = {}
    
    session_mapping = _sessions[session_key]
    total_entities = 0
    anonymized_messages = []
    
    for msg in messages:
        if 'content' not in msg or not isinstance(msg['content'], str):
            anonymized_messages.append(msg)
            continue
        
        anonymized_text, mapping, latency = shield(msg['content'], min_score=MIN_PII_SCORE)
        
        # Merge mapping into session
        session_mapping.update(mapping)
        total_entities += len(mapping)
        
        anonymized_messages.append({
            **msg,
            'content': anonymized_text
        })
    
    return anonymized_messages, total_entities


def deanonymize_response(text: str, session_key: str) -> str:
    """Restore PII in response using session mapping."""
    if session_key not in _sessions:
        return text
    return unshield(text, _sessions[session_key])


@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        'status': 'ok',
        'privacy_mode': PRIVACY_MODE,
        'local_llm': LOCAL_LLM_URL,
        'min_pii_score': MIN_PII_SCORE,
        'stats': stats,
        'active_sessions': len(_sessions)
    })


@app.route('/stats', methods=['GET'])
def get_stats():
    """Detailed stats endpoint."""
    return jsonify({
        **stats,
        'active_sessions': len(_sessions),
        'privacy_mode': PRIVACY_MODE
    })


@app.route('/v1/models', methods=['GET'])
def list_models():
    """Proxy model list from local LLM."""
    try:
        resp = requests.get(f'{LOCAL_LLM_URL}/v1/models', timeout=5)
        return Response(resp.content, status=resp.status_code, 
                       content_type=resp.headers.get('content-type', 'application/json'))
    except Exception as e:
        logger.error(f'Failed to list models: {e}')
        return jsonify({'error': str(e)}), 502


@app.route('/v1/chat/completions', methods=['POST'])
def chat_completions():
    """Proxy chat completions with PII filtering."""
    stats['requests'] += 1
    
    if not PRIVACY_MODE:
        stats['blocked'] += 1
        return jsonify({
            'error': {
                'message': 'Privacy mode is OFF. Set PRIVACY_MODE=on to enable routing.',
                'type': 'privacy_shield_disabled'
            }
        }), 403
    
    try:
        data = request.json
        messages = data.get('messages', [])
        is_streaming = data.get('stream', False)
        
        # Get or create session
        session_key = get_session_key(messages)
        
        # Anonymize messages
        anonymized_messages, entity_count = anonymize_messages(messages, session_key)
        
        if entity_count > 0:
            stats['pii_detections'] += 1
            stats['entities_stripped'] += entity_count
            logger.info(f'Stripped {entity_count} PII entities from request (session: {session_key})')
        
        # Build anonymized request
        anonymized_data = {
            **data,
            'messages': anonymized_messages
        }
        
        # Forward to local LLM
        resp = requests.post(
            f'{LOCAL_LLM_URL}/v1/chat/completions',
            json=anonymized_data,
            headers={'Content-Type': 'application/json'},
            timeout=120,
            stream=is_streaming
        )
        
        stats['proxied'] += 1
        
        # Handle streaming responses
        if is_streaming:
            def generate():
                buffer = ""
                for chunk in resp.iter_content(chunk_size=None):
                    if chunk:
                        # For SSE, we need to parse and deanonymize each data chunk
                        text = chunk.decode('utf-8')
                        # Simple approach: deanonymize the whole chunk
                        # (works because placeholders are distinctive)
                        deanonymized = deanonymize_response(text, session_key)
                        yield deanonymized.encode('utf-8')
            
            return Response(generate(), status=resp.status_code,
                          content_type=resp.headers.get('content-type'))
        
        # Non-streaming: parse, deanonymize, return
        response_data = resp.json()
        
        # Deanonymize assistant response
        if 'choices' in response_data:
            for choice in response_data['choices']:
                if 'message' in choice and 'content' in choice['message']:
                    choice['message']['content'] = deanonymize_response(
                        choice['message']['content'], 
                        session_key
                    )
        
        return jsonify(response_data)
    
    except requests.exceptions.Timeout:
        return jsonify({'error': {'message': 'Local LLM timeout', 'type': 'timeout'}}), 504
    except Exception as e:
        logger.error(f'Proxy error: {e}')
        return jsonify({'error': {'message': str(e), 'type': 'proxy_error'}}), 502


@app.route('/v1/completions', methods=['POST'])
def completions():
    """Proxy legacy completions with PII filtering."""
    stats['requests'] += 1
    
    if not PRIVACY_MODE:
        stats['blocked'] += 1
        return jsonify({'error': {'message': 'Privacy mode is OFF'}}), 403
    
    try:
        data = request.json
        prompt = data.get('prompt', '')
        
        # Anonymize prompt
        if isinstance(prompt, str):
            anonymized_prompt, mapping, _ = shield(prompt, min_score=MIN_PII_SCORE)
            if mapping:
                stats['pii_detections'] += 1
                stats['entities_stripped'] += len(mapping)
            data = {**data, 'prompt': anonymized_prompt}
        
        resp = requests.post(
            f'{LOCAL_LLM_URL}/v1/completions',
            json=data,
            headers={'Content-Type': 'application/json'},
            timeout=120
        )
        
        stats['proxied'] += 1
        
        # Deanonymize response
        response_data = resp.json()
        if 'choices' in response_data and mapping:
            for choice in response_data['choices']:
                if 'text' in choice:
                    choice['text'] = unshield(choice['text'], mapping)
        
        return jsonify(response_data)
    
    except Exception as e:
        logger.error(f'Proxy error: {e}')
        return jsonify({'error': {'message': str(e)}}), 502


@app.route('/v1/embeddings', methods=['POST'])
def embeddings():
    """Proxy embeddings - PII filtering recommended but optional."""
    stats['requests'] += 1
    
    if not PRIVACY_MODE:
        stats['blocked'] += 1
        return jsonify({'error': {'message': 'Privacy mode is OFF'}}), 403
    
    try:
        data = request.json
        input_text = data.get('input', '')
        
        # Anonymize input for embeddings too
        if isinstance(input_text, str):
            anonymized, mapping, _ = shield(input_text, min_score=MIN_PII_SCORE)
            if mapping:
                stats['pii_detections'] += 1
                stats['entities_stripped'] += len(mapping)
            data = {**data, 'input': anonymized}
        elif isinstance(input_text, list):
            anonymized_list = []
            for text in input_text:
                if isinstance(text, str):
                    anon, mapping, _ = shield(text, min_score=MIN_PII_SCORE)
                    if mapping:
                        stats['entities_stripped'] += len(mapping)
                    anonymized_list.append(anon)
                else:
                    anonymized_list.append(text)
            if stats['entities_stripped'] > 0:
                stats['pii_detections'] += 1
            data = {**data, 'input': anonymized_list}
        
        resp = requests.post(
            f'{LOCAL_LLM_URL}/v1/embeddings',
            json=data,
            headers={'Content-Type': 'application/json'},
            timeout=30
        )
        
        stats['proxied'] += 1
        
        return Response(resp.content, status=resp.status_code,
                       content_type=resp.headers.get('content-type', 'application/json'))
    
    except Exception as e:
        return jsonify({'error': {'message': str(e)}}), 502


# Kill switch endpoint
@app.route('/kill', methods=['POST'])
def kill_switch():
    """Emergency kill switch - disable all proxying."""
    global PRIVACY_MODE
    PRIVACY_MODE = False
    logger.warning('KILL SWITCH ACTIVATED - Privacy mode disabled')
    return jsonify({'status': 'killed', 'privacy_mode': False})


@app.route('/enable', methods=['POST'])
def enable():
    """Re-enable privacy mode after kill switch."""
    global PRIVACY_MODE
    PRIVACY_MODE = True
    logger.info('Privacy mode re-enabled')
    return jsonify({'status': 'enabled', 'privacy_mode': True})


if __name__ == '__main__':
    port = int(os.getenv('PORT', 5000))
    logger.info(f'Privacy Shield starting on port {port}')
    logger.info(f'Privacy mode: {"ON" if PRIVACY_MODE else "OFF"}')
    logger.info(f'Local LLM: {LOCAL_LLM_URL}')
    logger.info(f'Min PII score: {MIN_PII_SCORE}')
    app.run(host='0.0.0.0', port=port, debug=False)

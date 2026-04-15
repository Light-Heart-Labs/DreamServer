#include "llama.h"

#include <algorithm>
#include <cstddef>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <utility>
#include <vector>

static constexpr const char * kSystemPrompt =
    "You are Dream Server running locally on an iPhone shell. "
    "/no_think "
    "Reply in the same language as the user. "
    "Be concise, helpful, and direct. "
    "Do not reveal chain-of-thought. "
    "Never output <think> tags or hidden reasoning. "
    "Give only the final answer.";
static constexpr const char * kLegacyFastSystemPrompt =
    "Reply in the user's language. "
    "Answer only the latest user message. "
    "Avoid repeating old answers. "
    "Never narrate your reasoning. "
    "Do not write stage directions or parentheses. "
    "Keep replies short and direct.";
static constexpr size_t kDefaultMaxHistoryMessages = 1;

static void usage(const char * argv0) {
    std::fprintf(stderr, "usage: %s -m model.gguf [-p prompt] [-n n_predict] [-c ctx] [--history n_turns] [--legacy-prompt] [--legacy-chat] [-i]\n", argv0);
}

static void quiet_log_callback(enum ggml_log_level level, const char * text, void * /*user_data*/) {
    if (level >= GGML_LOG_LEVEL_ERROR) {
        std::fputs(text, stderr);
    }
}

static std::string trim_newlines(std::string text) {
    while (!text.empty() && (text.back() == '\n' || text.back() == '\r')) {
        text.pop_back();
    }
    return text;
}

static std::string trim_space(std::string text) {
    while (!text.empty() && (text.front() == ' ' || text.front() == '\n' || text.front() == '\r' || text.front() == '\t')) {
        text.erase(text.begin());
    }
    while (!text.empty() && (text.back() == ' ' || text.back() == '\n' || text.back() == '\r' || text.back() == '\t')) {
        text.pop_back();
    }
    return text;
}

struct chat_turn {
    std::string role;
    std::string content;
};

struct render_filter_state {
    bool in_think = false;
    std::string carry;
};

static std::string strip_assistant_prefix(std::string text) {
    text = trim_space(std::move(text));

    const char * prefixes[] = {
        "Assistant:",
        "assistant:",
        "ASSISTANT:",
        "<|im_start|>assistant",
        "<|assistant|>",
    };

    for (const char * prefix : prefixes) {
        const std::string value(prefix);
        if (text.rfind(value, 0) == 0) {
            text.erase(0, value.size());
            return trim_space(std::move(text));
        }
    }

    return text;
}

static size_t suffix_prefix_overlap(const std::string & text, const char * pattern) {
    const size_t pattern_len = std::strlen(pattern);
    const size_t max_overlap = text.size() < pattern_len ? text.size() : pattern_len - 1;

    for (size_t overlap = max_overlap; overlap > 0; --overlap) {
        if (text.compare(text.size() - overlap, overlap, pattern, overlap) == 0) {
            return overlap;
        }
    }

    return 0;
}

static void emit_visible_text(
        const std::string & chunk,
        std::string * generated_text,
        bool stream_output) {
    if (chunk.empty()) {
        return;
    }

    generated_text->append(chunk);
    if (stream_output) {
        std::fwrite(chunk.data(), 1, chunk.size(), stdout);
        std::fflush(stdout);
    }
}

static void consume_filtered_piece(
        render_filter_state * state,
        const std::string & piece,
        std::string * generated_text,
        bool stream_output) {
    static constexpr const char * kOpenTag = "<think>";
    static constexpr const char * kCloseTag = "</think>";
    const std::string open_tag(kOpenTag);
    const std::string close_tag(kCloseTag);

    state->carry += piece;

    while (true) {
        if (state->in_think) {
            const size_t close_pos = state->carry.find(close_tag);
            if (close_pos == std::string::npos) {
                const size_t keep = suffix_prefix_overlap(state->carry, kCloseTag);
                if (state->carry.size() > keep) {
                    state->carry.erase(0, state->carry.size() - keep);
                }
                return;
            }

            state->carry.erase(0, close_pos + close_tag.size());
            state->in_think = false;
            continue;
        }

        const size_t open_pos = state->carry.find(open_tag);
        if (open_pos == std::string::npos) {
            const size_t keep = suffix_prefix_overlap(state->carry, kOpenTag);
            const size_t emit_len = state->carry.size() - keep;
            if (emit_len > 0) {
                emit_visible_text(state->carry.substr(0, emit_len), generated_text, stream_output);
                state->carry.erase(0, emit_len);
            }
            return;
        }

        if (open_pos > 0) {
            emit_visible_text(state->carry.substr(0, open_pos), generated_text, stream_output);
        }

        state->carry.erase(0, open_pos + open_tag.size());
        state->in_think = true;
    }
}

static void flush_filtered_output(
        render_filter_state * state,
        std::string * generated_text,
        bool stream_output) {
    if (state->in_think) {
        state->carry.clear();
        return;
    }

    static constexpr const char * kOpenTag = "<think>";
    if (!state->carry.empty() && std::string(kOpenTag).rfind(state->carry, 0) == 0) {
        state->carry.clear();
        return;
    }

    emit_visible_text(state->carry, generated_text, stream_output);
    state->carry.clear();
}

static void trim_transcript_for_speed(std::vector<chat_turn> * transcript, size_t max_history_messages) {
    if (transcript->empty()) {
        return;
    }

    const size_t start_index = transcript->front().role == "system" ? 1 : 0;
    const size_t non_system_messages = transcript->size() > start_index ? transcript->size() - start_index : 0;
    if (non_system_messages <= max_history_messages) {
        return;
    }

    const size_t drop_count = non_system_messages - max_history_messages;
    transcript->erase(
        transcript->begin() + static_cast<std::ptrdiff_t>(start_index),
        transcript->begin() + static_cast<std::ptrdiff_t>(start_index + drop_count));
}

static void trim_legacy_transcript(std::vector<chat_turn> * transcript, size_t max_turns) {
    if (transcript->empty()) {
        return;
    }

    const size_t start_index = transcript->front().role == "system" ? 1 : 0;
    if (transcript->size() <= start_index) {
        return;
    }

    while (true) {
        const size_t payload_size = transcript->size() - start_index;
        const bool pending_user = !transcript->empty() && transcript->back().role == "user";
        const size_t limit = pending_user
            ? (max_turns == 0 ? 0 : max_turns * 2 - 1)
            : max_turns * 2;

        if (payload_size <= limit || payload_size < 2) {
            break;
        }

        transcript->erase(
            transcript->begin() + static_cast<std::ptrdiff_t>(start_index),
            transcript->begin() + static_cast<std::ptrdiff_t>(start_index + 2));
    }
}

static std::string build_fallback_chat_prompt(const std::vector<chat_turn> & turns, bool add_assistant) {
    std::string prompt;
    for (const chat_turn & turn : turns) {
        if (!prompt.empty()) {
            prompt += "\n";
        }

        if (turn.role == "assistant") {
            prompt += "Assistant: ";
        } else if (turn.role == "system") {
            prompt += "System: ";
        } else {
            prompt += "User: ";
        }

        prompt += turn.content;
    }

    if (add_assistant) {
        if (!prompt.empty()) {
            prompt += "\n";
        }
        prompt += "Assistant:";
    }

    return prompt;
}

static std::string build_chat_prompt(llama_model * model, const std::vector<chat_turn> & turns, bool add_assistant) {
    const char * tmpl = llama_model_chat_template(model, nullptr);
    if (tmpl == nullptr || turns.empty()) {
        return build_fallback_chat_prompt(turns, add_assistant);
    }

    std::vector<llama_chat_message> messages;
    messages.reserve(turns.size());
    for (const chat_turn & turn : turns) {
        messages.push_back({ turn.role.c_str(), turn.content.c_str() });
    }

    int32_t needed = llama_chat_apply_template(tmpl, messages.data(), messages.size(), add_assistant, nullptr, 0);
    if (needed <= 0) {
        return build_fallback_chat_prompt(turns, add_assistant);
    }

    std::string rendered(static_cast<size_t>(needed), '\0');
    const int32_t written = llama_chat_apply_template(
        tmpl,
        messages.data(),
        messages.size(),
        add_assistant,
        rendered.data(),
        static_cast<int32_t>(rendered.size()));

    if (written <= 0) {
        return build_fallback_chat_prompt(turns, add_assistant);
    }

    if (written < static_cast<int32_t>(rendered.size())) {
        rendered.resize(static_cast<size_t>(written));
    }

    return rendered;
}

static bool run_completion(
        llama_model * model,
        const std::string & prompt_text,
        int n_predict,
        int n_ctx,
        std::string * generated_text,
        bool stream_output,
        bool filter_think_output) {
    const llama_vocab * vocab = llama_model_get_vocab(model);
    const int prompt_bytes = static_cast<int>(prompt_text.size());
    const int n_prompt = -llama_tokenize(vocab, prompt_text.c_str(), prompt_bytes, nullptr, 0, true, true);
    if (n_prompt <= 0) {
        std::fprintf(stderr, "failed to tokenize prompt\n");
        return false;
    }

    std::vector<llama_token> prompt_tokens(static_cast<size_t>(n_prompt));
    if (llama_tokenize(vocab, prompt_text.c_str(), prompt_bytes, prompt_tokens.data(), n_prompt, true, true) < 0) {
        std::fprintf(stderr, "failed to tokenize prompt\n");
        return false;
    }

    llama_context_params ctx_params = llama_context_default_params();
    ctx_params.n_ctx = n_ctx;
    ctx_params.n_batch = static_cast<uint32_t>(n_prompt);
    ctx_params.n_ubatch = static_cast<uint32_t>(n_prompt);
    ctx_params.n_threads = 1;
    ctx_params.n_threads_batch = 1;
    ctx_params.no_perf = true;

    llama_context * ctx = llama_init_from_model(model, ctx_params);
    if (ctx == nullptr) {
        std::fprintf(stderr, "failed to create context\n");
        return false;
    }

    llama_sampler_chain_params sparams = llama_sampler_chain_default_params();
    sparams.no_perf = true;
    llama_sampler * sampler = llama_sampler_chain_init(sparams);
    if (filter_think_output) {
        llama_sampler_chain_add(sampler, llama_sampler_init_greedy());
    } else {
        llama_sampler_chain_add(sampler, llama_sampler_init_penalties(64, 1.12f, 0.0f, 0.0f));
        llama_sampler_chain_add(sampler, llama_sampler_init_top_k(24));
        llama_sampler_chain_add(sampler, llama_sampler_init_top_p(0.88f, 1));
        llama_sampler_chain_add(sampler, llama_sampler_init_temp(0.55f));
        llama_sampler_chain_add(sampler, llama_sampler_init_dist(LLAMA_DEFAULT_SEED));
    }
    render_filter_state render_state;

    llama_batch batch = llama_batch_get_one(prompt_tokens.data(), n_prompt);
    int processed = 0;

    while (processed + batch.n_tokens < n_prompt + n_predict) {
        if (llama_decode(ctx, batch) != 0) {
            std::fprintf(stderr, "decode failed\n");
            llama_sampler_free(sampler);
            llama_free(ctx);
            return false;
        }

        processed += batch.n_tokens;

        const llama_token token = llama_sampler_sample(sampler, ctx, -1);
        if (llama_vocab_is_eog(vocab, token)) {
            break;
        }

        char piece[128];
        const int n_piece = llama_token_to_piece(vocab, token, piece, sizeof(piece), 0, true);
        if (n_piece < 0) {
            std::fprintf(stderr, "token->piece failed\n");
            llama_sampler_free(sampler);
            llama_free(ctx);
            return false;
        }

        if (filter_think_output) {
            consume_filtered_piece(
                &render_state,
                std::string(piece, static_cast<size_t>(n_piece)),
                generated_text,
                stream_output);
        } else {
            emit_visible_text(std::string(piece, static_cast<size_t>(n_piece)), generated_text, stream_output);
            if (generated_text->find("\n\n") != std::string::npos) {
                break;
            }
        }
        batch = llama_batch_get_one(const_cast<llama_token *>(&token), 1);
    }

    if (filter_think_output) {
        flush_filtered_output(&render_state, generated_text, stream_output);
    }
    llama_sampler_free(sampler);
    llama_free(ctx);
    return true;
}

static bool run_completion_with_retry(
        llama_model * model,
        const std::string & prompt_text,
        int n_predict,
        int retry_n_predict,
        int n_ctx,
        std::string * generated_text,
        bool stream_output,
        bool filter_think_output) {
    generated_text->clear();

    if (!run_completion(model, prompt_text, n_predict, n_ctx, generated_text, stream_output, filter_think_output)) {
        return false;
    }

    if (!generated_text->empty() || retry_n_predict <= n_predict) {
        return true;
    }

    return run_completion(model, prompt_text, retry_n_predict, n_ctx, generated_text, stream_output, filter_think_output);
}

static int run_interactive_chat(llama_model * model, int n_predict, int n_ctx, size_t max_history_messages) {
    std::vector<chat_turn> transcript = { { "system", kSystemPrompt } };
    char line[2048];

    while (true) {
        std::fputs("you> ", stdout);
        std::fflush(stdout);

        if (std::fgets(line, sizeof(line), stdin) == nullptr) {
            std::fputc('\n', stdout);
            return 0;
        }

        std::string user_input = trim_newlines(line);
        if (user_input.empty()) {
            continue;
        }
        if (user_input == "/exit" || user_input == "exit" || user_input == "quit" || user_input == "/quit") {
            return 0;
        }

        transcript.push_back({ "user", user_input });
        trim_transcript_for_speed(&transcript, max_history_messages);
        const std::string prompt_text = build_chat_prompt(model, transcript, true);

        std::string reply;
        std::fputs("assistant> ", stdout);
        std::fflush(stdout);

        const int retry_n_predict = std::max(n_predict * 2, 128);
        if (!run_completion_with_retry(model, prompt_text, n_predict, retry_n_predict, n_ctx, &reply, true, true)) {
            return 1;
        }

        reply = strip_assistant_prefix(trim_newlines(reply));
        if (reply.empty()) {
            reply = "Desculpe, fiquei sem resposta visivel. Tente uma pergunta mais curta.";
            std::fputs(reply.c_str(), stdout);
        }
        std::fputc('\n', stdout);
        std::fflush(stdout);

        transcript.push_back({ "assistant", reply });
    }
}

static int run_interactive_legacy_chat(llama_model * model, int n_predict, int n_ctx, size_t max_history_turns) {
    std::vector<chat_turn> transcript = { { "system", kLegacyFastSystemPrompt } };
    char line[2048];

    while (true) {
        std::fputs("you> ", stdout);
        std::fflush(stdout);

        if (std::fgets(line, sizeof(line), stdin) == nullptr) {
            std::fputc('\n', stdout);
            return 0;
        }

        std::string user_input = trim_newlines(line);
        if (user_input.empty()) {
            continue;
        }
        if (user_input == "/exit" || user_input == "exit" || user_input == "quit" || user_input == "/quit") {
            return 0;
        }

        transcript.push_back({ "user", user_input });
        trim_legacy_transcript(&transcript, max_history_turns);
        const std::string prompt_text = build_fallback_chat_prompt(transcript, true);

        std::string reply;
        std::fputs("assistant> ", stdout);
        std::fflush(stdout);

        if (!run_completion(model, prompt_text, n_predict, n_ctx, &reply, true, false)) {
            return 1;
        }

        reply = strip_assistant_prefix(trim_newlines(reply));
        if (reply.empty()) {
            reply = "Desculpe, fiquei sem resposta visivel. Tente de novo.";
            std::fputs(reply.c_str(), stdout);
        }
        std::fputc('\n', stdout);
        std::fflush(stdout);

        transcript.push_back({ "assistant", reply });
        trim_legacy_transcript(&transcript, max_history_turns);
    }
}

int main(int argc, char ** argv) {
    const char * model_path = nullptr;
    const char * prompt = "oi";
    int n_predict = 48;
    int n_ctx = 1024;
    size_t max_history_messages = kDefaultMaxHistoryMessages;
    bool interactive = false;
    bool legacy_prompt = false;
    bool legacy_chat = false;

    for (int i = 1; i < argc; ++i) {
        if (std::strcmp(argv[i], "-m") == 0 && i + 1 < argc) {
            model_path = argv[++i];
        } else if (std::strcmp(argv[i], "-p") == 0 && i + 1 < argc) {
            prompt = argv[++i];
        } else if (std::strcmp(argv[i], "-n") == 0 && i + 1 < argc) {
            n_predict = std::atoi(argv[++i]);
        } else if (std::strcmp(argv[i], "-c") == 0 && i + 1 < argc) {
            n_ctx = std::atoi(argv[++i]);
        } else if ((std::strcmp(argv[i], "--history") == 0 || std::strcmp(argv[i], "--history-messages") == 0) && i + 1 < argc) {
            max_history_messages = static_cast<size_t>(std::max(0, std::atoi(argv[++i])));
        } else if (std::strcmp(argv[i], "--fast-prompt") == 0 || std::strcmp(argv[i], "--legacy-prompt") == 0) {
            legacy_prompt = true;
        } else if (std::strcmp(argv[i], "--fast-chat") == 0 || std::strcmp(argv[i], "--legacy-chat") == 0) {
            legacy_chat = true;
        } else if (std::strcmp(argv[i], "-i") == 0) {
            interactive = true;
        } else {
            usage(argv[0]);
            return 1;
        }
    }

    if (model_path == nullptr) {
        usage(argv[0]);
        return 1;
    }

    llama_log_set(quiet_log_callback, nullptr);
    ggml_backend_load_all();

    llama_model_params model_params = llama_model_default_params();
    model_params.n_gpu_layers = 0;
    model_params.use_mmap = false;
    model_params.use_mlock = false;

    llama_model * model = llama_model_load_from_file(model_path, model_params);
    if (model == nullptr) {
        std::fprintf(stderr, "failed to load model\n");
        return 1;
    }

    if (interactive) {
        const int rc = legacy_chat
            ? run_interactive_legacy_chat(model, n_predict, n_ctx, max_history_messages)
            : run_interactive_chat(model, n_predict, n_ctx, max_history_messages);
        llama_model_free(model);
        return rc;
    }

    std::string generated;
    const std::string prompt_text = legacy_prompt
        ? build_fallback_chat_prompt({ { "system", kLegacyFastSystemPrompt }, { "user", prompt } }, true)
        : build_chat_prompt(model, { { "system", kSystemPrompt }, { "user", prompt } }, true);

    const bool ok = legacy_prompt
        ? run_completion(model, prompt_text, n_predict, n_ctx, &generated, true, false)
        : run_completion_with_retry(model, prompt_text, n_predict, std::max(n_predict * 2, 96), n_ctx, &generated, true, true);
    if (!ok) {
        llama_model_free(model);
        return 1;
    }

    generated = strip_assistant_prefix(trim_newlines(generated));
    if (generated.empty()) {
        generated = "Desculpe, fiquei sem resposta visivel. Tente uma pergunta mais curta.";
        std::fputs(generated.c_str(), stdout);
    }
    std::fputc('\n', stdout);
    llama_model_free(model);
    return 0;
}

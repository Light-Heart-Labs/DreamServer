const path = require("path");
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const { DreamRuntime } = require("./core");
const { createDefaultState } = require("./state");

const PROTO_PATH = path.join(__dirname, "proto", "dreamserver.proto");

function createGrpcServer(options = {}) {
  const runtime = new DreamRuntime({
    initialState: options.initialState || createDefaultState(),
    workspaceRoot: options.workspaceRoot || process.cwd()
  });

  const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true
  });
  const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
  const service = protoDescriptor.dreamserver.v1.DreamAgentService.service;
  const server = new grpc.Server();

  server.addService(service, {
    Chat(call) {
      const sessionMap = new Map();
      const unsubscribe = runtime.subscribe(({ chatId, event }) => {
        const sessionId = sessionMap.get(chatId) || chatId;

        if (event.type === "text_delta") {
          call.write({
            text_delta: {
              session_id: sessionId,
              message_id: event.messageId || "",
              delta: event.delta || ""
            }
          });
          return;
        }

        if (event.type === "message_final") {
          call.write({
            message_final: {
              session_id: sessionId,
              message_id: event.messageId || "",
              content: event.content || ""
            }
          });
          return;
        }

        if (event.type === "tool_call_started") {
          call.write({
            tool_started: {
              session_id: sessionId,
              action_key: event.actionKey || "",
              action_json: JSON.stringify(event.action || {}),
              permission_class: event.permissionClass || "",
              ok: false,
              result: ""
            }
          });
          return;
        }

        if (event.type === "tool_call_finished") {
          call.write({
            tool_finished: {
              session_id: sessionId,
              action_key: event.actionKey || "",
              action_json: JSON.stringify(event.action || {}),
              permission_class: event.permissionClass || "",
              ok: Boolean(event.ok),
              result: event.result || ""
            }
          });
          return;
        }

        if (event.type === "permission_request") {
          call.write({
            permission_request: {
              session_id: sessionId,
              request_id: event.requestId || "",
              action_json: JSON.stringify(event.action || {}),
              permission_class: event.permissionClass || ""
            }
          });
          return;
        }

        if (event.type === "task_state_changed" || event.type === "stopped") {
          call.write({
            state_changed: {
              session_id: sessionId,
              status: event.status || event.type,
              detail: event.reason || ""
            }
          });
          return;
        }

        if (event.type === "error") {
          call.write({
            error: {
              session_id: sessionId,
              message: event.message || "Erro interno."
            }
          });
        }
      });

      call.on("data", async (clientMessage) => {
        try {
          if (clientMessage.request) {
            const request = clientMessage.request;
            runtime.createChat(request.provider || runtime.state.settings.providerMode);
            const chatId = runtime.state.selectedChatId;
            sessionMap.set(chatId, request.session_id || chatId);
            if (request.provider) {
              runtime.setChatProvider(chatId, request.provider);
            }
            if (request.model) {
              runtime.updateSettings({ localModel: request.model });
            }
            await runtime.sendMessage({
              chatId,
              text: request.message,
              attachmentPaths: [],
              cloudApiKey: process.env.MANUS_API_KEY || ""
            });
            return;
          }

          if (clientMessage.permission) {
            for (const chatId of sessionMap.keys()) {
              try {
                await runtime.runSuggestedAction({
                  chatId,
                  actionKey: clientMessage.permission.request_id,
                  cloudApiKey: process.env.MANUS_API_KEY || ""
                });
                break;
              } catch {}
            }
            return;
          }

          if (clientMessage.cancel) {
            for (const [chatId, sessionId] of sessionMap.entries()) {
              if (sessionId === clientMessage.cancel.session_id) {
                await runtime.stopChat(chatId);
              }
            }
          }
        } catch (error) {
          call.write({
            error: {
              session_id: clientMessage.request?.session_id || "",
              message: error.message || "Falha no servidor."
            }
          });
        }
      });

      call.on("end", () => {
        unsubscribe();
        call.end();
      });
    }
  });

  return { runtime, server };
}

if (require.main === module) {
  const { server } = createGrpcServer();
  const host = process.env.GRPC_HOST || "localhost";
  const port = Number(process.env.GRPC_PORT || 50051);
  server.bindAsync(`${host}:${port}`, grpc.ServerCredentials.createInsecure(), (error) => {
    if (error) {
      throw error;
    }
    server.start();
    console.log(`Dream Server gRPC on ${host}:${port}`);
  });
}

module.exports = {
  createGrpcServer
};

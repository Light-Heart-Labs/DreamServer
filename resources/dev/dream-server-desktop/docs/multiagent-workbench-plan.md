# Dream Desktop multiagent workbench layer

Este plano adapta o modelo visual de workbench multiagente sem criar um runtime paralelo. Toda criacao, execucao e validacao deve passar pelo runtime Hermes/Dream ja existente: `task_*`, `agent_*`, `terminal_*`, `git_worktree_*`, `browser_*`, `verify_*` e MCP quando disponivel.

## Fatia 1 - Navegacao principal

Status: implementado.

- Adicionar alternancia no header entre `Chat`, `Kanban` e `Multiagente`.
- Manter o chat como entrada principal de pedidos livres.
- Mostrar Kanban e terminais na tela central, nao apenas no Workbench lateral.
- Preservar Workbench lateral para preview, codigo, alteracoes e jobs.

## Fatia 2 - Kanban Hermes

Status: implementado como base.

- Criar cards com `task_create`.
- Mover cards com `task_update`.
- Parar cards com `task_stop` ou `task_update(status="stopped")`.
- Exibir colunas: `pending`, `running`, `blocked`, `done`, `stopped`.
- Permitir spawn de subagente a partir de um card com `agent_spawn`.

Proximo incremento:

- Adicionar drag and drop entre colunas chamando `task_update`.
- Salvar filtro por rota/provedor.
- Relacionar tarefas a projetos recentes (`projects`) e previews do Workbench.
- Adicionar botao "promover para roadmap" usando um registro persistente novo, mas criado por action Hermes.

## Fatia 3 - Terminais multiagente

Status: implementado como base.

- Criar subagentes com `agent_spawn`.
- Executar comandos em sessoes persistentes com `terminal_exec`.
- Fechar terminal com `desktop:close-terminal-session`, que delega ao runtime.
- Parar subagente com `agent_stop`.
- Exibir stdout/stderr, status, provider, rota e worktree.

Proximo incremento:

- Mostrar ate 12 lanes de agentes/terminais no workbench multiagente.
- Criar presets de agentes: builder, reviewer, verifier, researcher.
- Adicionar "inject context" para enviar objetivo/card selecionado ao terminal.
- Permitir dividir um card em subtarefas e spawnar varios agentes em worktrees separadas.

## Fatia 4 - Worktrees e merge

Status: runtime ja possui base.

- Usar `git_worktree_add` quando `agent_spawn(useWorktree=true)` receber repo git valido.
- Exibir branch e path no card/agente.
- Adicionar comandos UI para listar/remover worktrees via `git_worktree_list` e `git_worktree_remove`.
- Implementar uma etapa de merge assistido pelo Hermes, sempre precedida por `git_status` e verificacoes.

## Fatia 5 - Validacao automatica

Status: runtime ja possui ferramentas.

- Depois de edits e comandos, exigir `verify_file`, `verify_command`, `verify_url`, `verify_site` ou `browser_check`.
- Mostrar evidencias no Workbench lateral e no card Kanban.
- Bloquear conclusao visual quando a ultima evidencia falhou.

## Fatia 6 - Roadmap, insights, ideation e changelog

Status: pendente.

- Roadmap: lista persistente derivada de tarefas e projetos, criada por `task_create` ou futura action `roadmap_create`.
- Insights: chat de leitura de codigo que usa `read_file`, `grep_files`, `workspace_symbols` e LSP antes de responder.
- Ideation: gerador de melhorias que cria cards no Kanban, nao altera arquivos diretamente.
- Changelog: sumarizar tarefas `done` e evidencias, com botao para gerar Markdown via `write_file`.

## Regra de arquitetura

- UI nunca executa comando direto.
- UI nunca cria agente fora do runtime.
- UI nunca altera arquivos do projeto-alvo por conta propria.
- Qualquer coisa operacional deve virar uma action Hermes e passar por `window.manusDesktop.runDesktopAction`.
- Kanban interno pode manipular estado persistente apenas via `task_*`.
- Terminal e subagente exigem `fullAccessMode`, mantendo o mesmo controle de permissao do Dream Server.

## Referencia de produto

- Workbench multiagente: Kanban, agent terminals, parallel execution, isolated workspaces, QA loop, merge assistido, memory, integrations, roadmap, insights, ideation e changelog.

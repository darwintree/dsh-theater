# Implementation Trace: 移除旧 Theater Web bundle

Date: 2026-08-28
Source: 用户请求“我们不考虑演出。可以先把旧插件卸载”
Language: 中文

## Entries

### 1. 用新版 Theater runtime 满足 Gomoku 贡献依赖

Type: unresolved-implementation-decision

Context:
移除 `@darwintree/dsh-theater-web` 后，Web profile 中现有的 `@darwintree/dsh-theater-gomoku/theater` 因缺少 `theater` service 无法激活。请求没有约定是移除整个 Gomoku bundle，还是替换旧 bundle 曾间接提供的 Theater runtime。

Decision:
保留新版 Stage 和 Gomoku bundle，并将 `dsh-theater-new` 的 `@darwintree/dsh-theater` runtime 加入 Web profile；不恢复旧 Theater Web UI。

Reason:
这保持当前新版模块组合完整，同时准确移除用户指定的旧插件；相比增加一层 profile patch 来禁用 Gomoku 的 Theater 贡献，直接加载其声明依赖更简单。

Follow-up:
None.

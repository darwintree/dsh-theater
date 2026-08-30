# Implementation Trace: Performance cwd

Date: 2026-08-28
Source: 用户请求“那我们加上cwd吧，作为可观测性的一环”
Language: 中文

## Entries

### 1. 由入口显式提供 cwd

Type: unresolved-implementation-decision

Context:
DSH Web 在创建普通 Session 时使用 Workspace、请求参数或启动目录解析 `cwd`，但 Theater 直接调用底层 Session API；请求没有约定 Theater 应读取进程全局状态，还是由调用入口传值。

Decision:
将 `cwd` 设为 `CreatePerformanceInput` 的必填字段。Headless 入口传入 `process.cwd()`；Performance Session 持久化该值，Character Session 继承它，Performance Fork 继续使用 DSH 原生 Session Fork 对 `cwd` 的继承。

Reason:
入口最清楚 Workspace 归属。显式输入既让 Session 可被 DSH 原生列表观测，也避免 Theater Service 隐式依赖宿主进程目录，并为未来 Web 入口传入所选 Workspace 留出直接路径。

Follow-up:
None.

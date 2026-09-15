# Production Workforce Bootstrap

`api/production-workforce-config.ts` is the authoritative, version-controlled
non-secret capability declaration. `api/production-workforce-bootstrap.ts` is
the runtime-neutral capability assembly boundary. A future Node server or
Firebase HTTPS Function validates the configuration once at cold start, then
passes its registries and policies to the Control Plane composition root.

```
trusted TypeScript configuration
  -> bootstrap validation
  -> AgentRegistry / RoutingAgentExecutor / ToolRegistry / ProjectRegistry
  -> DEPLOY-1A composition root
  -> createControlPlaneApi
```

Bindings are selected only from trusted compiled code. Configuration cannot
name arbitrary modules, execute strings, or enable test fixtures. Agent and
tool references are checked before startup; duplicate ids, unknown executors,
unknown handlers, and dangling tool/agent references fail closed.

The bootstrap deliberately has no fallback executor. A deployment with zero
registered executable agents is valid but reports `operational: false`; it is
not an operational agent runtime. Environment-dependent adapters, such as
Money Mind, must be registered only after their explicit configuration has
been validated by the composition root.

To add an agent safely: implement its real executor, register a trusted binding
key, define its declarative `Agent`, declare only its permitted tools and
grants, and let bootstrap validation resolve every reference.

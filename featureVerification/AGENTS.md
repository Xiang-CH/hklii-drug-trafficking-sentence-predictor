# Agent Guidelines - Feature Verification

TanStack Start + React 19 app for verifying drug sentencing data from HK court judgments.
Stack: React 19, TanStack Router/Query, Zod, shadcn/ui, MongoDB, Better-Auth, 

## Commands

```bash
cd featureVerification
pnpm build           # Production build
pnpm test            # Run tests (vitest)
pnpm test -- src/lib/foo.test.ts  # Single test
pnpm lint            # ESLint
pnpm format          # Prettier check
pnpm check           # Prettier + ESLint fix
```

Check type errors with `pnpm build` or `pnpm check`.
Always run `pnpm check` after changes to ensure code quality and consistency.
Never run `pnpm dev` assume dev server is running.

## Style

- **No comments** unless asked
- **No semicolons**, **single quotes**, **trailing commas**
- **Strict TypeScript** - all unused locals/params must be removed
- **Imports**: Use `@/` prefix (e.g., `import { Foo } from '@/lib/foo'`)
- **Naming**: PascalCase (components/types), camelCase (functions), snake_case (DB fields)

## Key Conventions

- TanStack Router file-based routing in `src/routes/`
- Zod schemas in `src/lib/schema/`
- shadcn/ui components in `src/components/ui/`
- Add new UI: `pnpm dlx shadcn@latest add <component>`
- Auth: `import { authClient } from '@/lib/auth-client'`
- Database: MongoDB via `src/lib/db.ts`

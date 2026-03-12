# Contributing to Dream Server

First off, thanks for wanting to contribute! Dream Server is an open source project and we welcome help from everyone -- whether you're fixing a typo, adding a cookbook recipe, or tackling a full feature.

## Quick Start

1. **Fork** this repository and **clone** your fork locally.
2. Create a **branch** for your work:
   ```bash
   git checkout -b my-change
   ```
3. Make your changes, test them locally, and commit.
4. Open a **pull request** against `main`.

That's it. No CLA, no hoops.

## What We're Looking For

All kinds of contributions are valuable. Here are some great places to start:

- **Bug fixes** -- something broken? Fix it and send a PR.
- **Documentation improvements** -- clearer install instructions, better troubleshooting guides, typo fixes.
- **New cookbook recipes** -- workflows, prompt templates, or integration examples that help other users.
- **Test coverage** -- more tests means fewer surprises.
- **Feature work** -- check the issue tracker for ideas, or propose your own.

If you're new here, look for issues labeled **`good first issue`**. These are scoped, well-defined tasks that are a great way to get familiar with the codebase.

## Code Style

Nothing exotic:

- **Shell scripts** are written in Bash. Use `shellcheck` if you can.
- **Python** uses standard formatting (we're not picky -- just be consistent with the file you're editing).
- Keep things readable. Comments are welcome where intent isn't obvious.

## Pre-commit Hooks

This project uses pre-commit hooks to ensure code quality. To set up:

```bash
pip install pre-commit
pre-commit install
```

The hooks will run automatically on `git commit` and check for:
- Secret leaks (gitleaks)
- Shell script issues (shellcheck)
- Python linting (ruff)
- Python formatting (black)
- Large files, trailing whitespace, YAML/JSON syntax

To run hooks manually on all files:

```bash
pre-commit run --all-files
```

To bypass hooks (not recommended):

```bash
git commit --no-verify
```

## Pull Request Process

1. **Describe your changes** in the PR description. A sentence or two is fine for small changes; more detail helps for larger ones.
2. **Link related issues** if they exist (e.g. "Fixes #42").
3. Make sure existing functionality isn't broken.
4. A maintainer will review your PR and may suggest changes. We try to be responsive.

## Where to Ask Questions

Not sure about something? Open a thread in [GitHub Discussions](https://github.com/Light-Heart-Labs/DreamServer/discussions). We're happy to help you figure out the best approach before you write any code.

## License

By contributing to Dream Server, you agree that your contributions will be licensed under the [Apache License 2.0](LICENSE), the same license that covers this project.

---

Thanks for helping make local AI infrastructure better for everyone.

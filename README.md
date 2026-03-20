# Entire Desktop

AI development session manager built with Tauri, React, and TypeScript.

## Prerequisites

- **Node.js** (v18+) and **npm**
- **Rust** (stable) — install via [rustup](https://rustup.rs/)
- **macOS** — links against macOS-specific frameworks (Metal, AppKit, etc.) and is currently macOS-only

## Setup

1. Clone the repo:

   ```sh
   git clone git@github.com:alishakawaguchi/entire-app.git
   cd entire-app
   ```

2. Download the vendored `libghostty.a` binary (native Metal terminal renderer):

   ```sh
   ./src-tauri/vendor/ghostty/download.sh
   ```

   See [`src-tauri/vendor/ghostty/BUILD.md`](src-tauri/vendor/ghostty/BUILD.md) for alternative options (building from source, etc.).

3. Install npm dependencies:

   ```sh
   npm install
   ```

4. Set environment variables:

   ```sh
   export ANTHROPIC_API_KEY=your-key-here  # required for AI features
   ```

## Running

```sh
npm run tauri dev
```

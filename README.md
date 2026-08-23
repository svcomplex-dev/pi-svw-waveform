# pi-svw-waveform

A [Pi package](https://pi.dev/packages) that installs the public
[svw](https://github.com/svcomplex-dev/svw) binary, loads the
`svw-waveform` Skill, and registers the native `svw_wave_render` terminal tool.

## Install

```sh
pi install npm:pi-svw-waveform
```

Until the first npm release is published, the same package can be installed
directly from GitHub:

```sh
pi install git:github.com/svcomplex-dev/pi-svw-waveform
```

Pi records the package in `~/.pi/agent/settings.json` and loads both the Skill
and extension on subsequent runs.

## What installation does

The package bootstrap is intentionally platform-specific. Published package
versions pin the immutable `release-X.Y.Z` that triggered their publication:

- Linux x64 downloads the pinned public GitHub Release archive and checksum,
  verifies SHA-256 through the audited svw installer, and keeps the installation
  inside this Pi package.
- Apple Silicon macOS installs or upgrades the matching versioned Formula from
  `svcomplex-dev/tap` through Homebrew, then verifies `svw --version`.
- Other platforms fail explicitly.

Set `SVW_PI_VERSION=latest` to override the packaged release, or set
`SVW_PI_VERSION=0.1.0` while installing to select another immutable
`release-0.1.0` artifact. Set `SVW_PI_SKIP_INSTALL=1` only when reviewing the
package or when a compatible `svw` is already supplied through `SVW_BIN`.

Pi packages execute with full user privileges. Review this repository,
especially `scripts/install-svw.mjs` and `scripts/install-svw.sh`, before
installation.

## Use

Ask Pi to inspect a VCD or FST waveform. The bundled Skill guides bounded
metadata, signal, value, change, comparison, and render queries. The extension's
`svw_wave_render` tool displays a complete colored waveform in Pi's terminal
without duplicating the canvas into model context.

Override binary discovery only when required:

```sh
SVW_BIN=/absolute/path/to/svw pi
```

## Development

```sh
scripts/setup-git-hooks.sh
SVW_PI_SKIP_INSTALL=1 npm install
npm run verify
npm run smoke:pi
```

All repository commits must use `code@svcomplex.ai` for both author and
committer identities. The tracked hooks and GitHub identity workflow enforce
this policy.

## Publishing

Tags named `vX.Y.Z` publish the matching package version to npm. A trusted
`svw-release-published` repository dispatch also advances the package patch,
pins that svw release, runs the package gates, and publishes through npm OIDC.
The `pi-package` keyword makes the npm release discoverable in the Pi package
gallery; no persistent npm publishing token is used.

## License

MIT

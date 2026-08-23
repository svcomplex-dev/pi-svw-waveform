// SPDX-License-Identifier: MIT
// Copyright (c) 2026 code@svcomplex.ai
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type Component, sliceByColumn, Text, visibleWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";

const MAX_FRAME_BYTES = 512 * 1024;
const SGR_SEQUENCE = /\x1b\[[0-9;]*m/g;

const packagedBinary = fileURLToPath(new URL("../vendor/bin/svw", import.meta.url));
const homebrewBinaries = ["/opt/homebrew/bin/svw", "/usr/local/bin/svw"];

function resolveSvwBinary(): string {
	const configured = process.env.SVW_BIN?.trim();
	if (configured) {
		return configured;
	}
	if (existsSync(packagedBinary)) {
		return packagedBinary;
	}
	for (const candidate of homebrewBinaries) {
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	return "svw";
}

interface WaveformDetails {
	ansi: string;
	end: number;
	height: number;
	start: number;
	waveform: string;
	width: number;
}

class WaveformFrame implements Component {
	constructor(private readonly ansi: string) {}

	render(width: number): string[] {
		const available = Math.max(1, width);
		const frameLines = this.ansi.endsWith("\n")
			? this.ansi.slice(0, -1).split("\n")
			: this.ansi.split("\n");
		return frameLines.map((line) =>
			visibleWidth(line) <= available ? line : sliceByColumn(line, 0, available),
		);
	}

	invalidate(): void {}
}

function normalizeWaveformPath(path: string): string {
	return path.startsWith("@") ? path.slice(1) : path;
}

function validateFrame(ansi: string, expectedHeight: number, expectedWidth: number): void {
	if (Buffer.byteLength(ansi, "utf8") > MAX_FRAME_BYTES) {
		throw new Error("svw returned an unexpectedly large waveform frame");
	}
	const plain = ansi.replace(SGR_SEQUENCE, "");
	if (/\x1b|[\x00-\x08\x0b-\x1f\x7f]/.test(plain)) {
		throw new Error("svw waveform frame contains unsupported terminal control sequences");
	}
	const lines = (plain.endsWith("\n") ? plain.slice(0, -1) : plain).split("\n");
	if (lines.length !== expectedHeight) {
		throw new Error(`svw returned ${lines.length} rows, expected ${expectedHeight}`);
	}
	if (lines.some((line) => visibleWidth(line) > expectedWidth)) {
		throw new Error("svw waveform frame exceeds its requested column bound");
	}
}

const WaveformParameters = Type.Object({
	waveform: Type.String({ description: "VCD or FST waveform path", minLength: 1 }),
	start: Type.Integer({ description: "Inclusive starting native waveform tick" }),
	end: Type.Integer({ description: "Inclusive ending native waveform tick" }),
	hier: Type.Array(Type.String({ description: "Exact full hierarchical signal name from svw agent signals", minLength: 1 }), {
		description: "Hierarchical signals shown from top to bottom",
		minItems: 1,
		maxItems: 12,
	}),
	width: Type.Optional(Type.Integer({ description: "Frame columns", minimum: 60, maximum: 240 })),
	height: Type.Optional(Type.Integer({ description: "Frame rows", minimum: 14, maximum: 80 })),
});

export default function svwWaveformExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "svw_wave_render",
		label: "svw waveform",
		description:
			"Render one to twelve exact full hierarchical signal names as a complete colored terminal waveform. " +
			"Use `svw agent WAVEFORM signals` first and copy its name fields exactly.",
		promptSnippet: "Render a complete colored svw waveform directly in Pi's terminal UI",
		promptGuidelines: [
			"Use svw_wave_render instead of a shell render command when the user asks to see a waveform in Pi; the extension keeps the hierarchical-name and wave canvas out of model text and renders it through Pi's TUI.",
		],
		parameters: WaveformParameters,
		renderShell: "self",

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (params.end <= params.start) {
				throw new Error("end must be greater than start");
			}
			const width = params.width ?? 100;
			const height = params.height ?? Math.max(14, Math.min(80, 10 + params.hier.length * 4));
			const waveform = normalizeWaveformPath(params.waveform);
			const binary = resolveSvwBinary();
			const args = [
				"agent",
				waveform,
				"render",
				String(params.start),
				String(params.end),
				...params.hier,
				"--width",
				String(width),
				"--height",
				String(height),
				"--color",
				"ansi",
				"--view",
				"wave",
			];
			const result = await pi.exec(binary, args, {
				cwd: ctx.cwd,
				signal,
				timeout: 30_000,
			});
			if (result.code !== 0) {
				const detail = result.stderr.trim() || `svw exited with status ${result.code}`;
				throw new Error(detail.slice(0, 4096));
			}
			const canvasHeight = 1 + params.hier.length * 4;
			validateFrame(result.stdout, canvasHeight, width);
			const details: WaveformDetails = {
				ansi: result.stdout,
				end: params.end,
				height: canvasHeight,
				start: params.start,
				waveform,
				width,
			};
			return {
				content: [
					{
						type: "text" as const,
						text:
							`Rendered the complete ${width}x${canvasHeight} svw wave canvas for ${params.hier.length} ` +
							`signal(s) over native ticks ${params.start}..${params.end}. ` +
							"The colored frame is displayed by the Pi extension and is intentionally not duplicated in model text.",
					},
				],
				details,
			};
		},

		renderCall() {
			return new Text("", 0, 0);
		},

		renderResult(result, { isPartial }, theme) {
			if (isPartial) {
				return new Text(theme.fg("warning", "Rendering waveform..."), 0, 0);
			}
			const details = result.details as WaveformDetails | undefined;
			if (!details?.ansi) {
				const fallback = result.content.find((item) => item.type === "text");
				return new Text(
					theme.fg("error", fallback?.type === "text" ? fallback.text : "Waveform render failed"),
					0,
					0,
				);
			}
			return new WaveformFrame(details.ansi);
		},
	});
}

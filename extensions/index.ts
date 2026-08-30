// SPDX-License-Identifier: MIT
// Copyright (c) 2026 code@svcomplex.ai
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type Component, sliceByColumn, Text, visibleWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { accessSync, constants } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_FRAME_BYTES = 512 * 1024;
const SGR_SEQUENCE = /\x1b\[[0-9;]*m/g;

interface WaveformDetails {
	ansi: string;
	end: number;
	height: number;
	start: number;
	waveform: string;
	width: number;
}

interface RenderEnvelope {
	end: number;
	sample_text: string;
	start: number;
	styled_text: string;
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

function resolveSvwBinary(): string {
	const configured = process.env.SVW_BIN?.trim();
	if (configured) return configured;
	const here = dirname(fileURLToPath(import.meta.url));
	for (const candidate of [join(here, "vendor", "bin", "svw"), join(here, "..", "vendor", "bin", "svw")]) {
		try {
			accessSync(candidate, constants.X_OK);
			return candidate;
		} catch {
			// Continue to the next package layout, then fall back to PATH.
		}
	}
	return "svw";
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

const WaveTime = Type.Union([
	Type.Integer(),
	Type.String({ pattern: "^(?:[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:s|ms|us|ns|ps|fs)|cycle:\\d+@.+)$" }),
]);

const WaveformParameters = Type.Object({
	waveform: Type.String({ description: "VCD, FST, FSDB, or KBX waveform path", minLength: 1 }),
	start: WaveTime,
	end: WaveTime,
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
			if (typeof params.start === "number" && typeof params.end === "number" && params.end <= params.start) {
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
				"--json",
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
			let envelope: RenderEnvelope;
			try {
				envelope = JSON.parse(result.stdout) as RenderEnvelope;
			} catch {
				throw new Error("svw returned an invalid render JSON envelope");
			}
			if (typeof envelope.styled_text !== "string" || typeof envelope.sample_text !== "string" ||
				!Number.isInteger(envelope.start) || !Number.isInteger(envelope.end)) {
				throw new Error("svw render JSON is missing styled_text or sample_text");
			}
			const canvasHeight = 1 + params.hier.length * 4;
			validateFrame(envelope.styled_text, canvasHeight, width);
			const details: WaveformDetails = {
				ansi: envelope.styled_text,
				end: envelope.end,
				height: canvasHeight,
				start: envelope.start,
				waveform,
				width,
			};
			return {
				content: [
					{
						type: "text" as const,
						text:
							`Rendered the complete ${width}x${canvasHeight} svw wave canvas for ${params.hier.length} ` +
							`signal(s) over native ticks ${envelope.start}..${envelope.end}. ` +
							"The colored frame is displayed by the Pi extension. Compact final values:\n" +
							envelope.sample_text,
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

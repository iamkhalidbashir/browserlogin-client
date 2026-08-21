import { isManifestTool, UNSAFE_TOOL_NAME, visibleTools } from "./manifest";
import { ProfileResolver } from "./resolver";
import { RuntimePool } from "./runtime-pool";
import type {
  BrowserToolResult,
  JsonObject,
  VendorCallResult,
  VendorTool,
} from "./types";
import {
  ALLOW_UNSAFE_ENV,
  GENERIC_BROWSER_ERROR,
  GENERIC_STOP_ERROR,
  ProfileNotRunningError,
} from "./types";

export type BrowserLifecycle = {
  stop(profileId: string): Promise<unknown>;
};

const textResult = (text: string, isError = false): BrowserToolResult => ({
  content: [{ type: "text", text }],
  isError,
});

const asObject = (value: unknown): JsonObject =>
  value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as JsonObject) }
    : {};

const isTruthyPython = (value: unknown): boolean =>
  String(value).toLowerCase() === "true" ||
  String(value).toLowerCase() === "1" ||
  String(value).toLowerCase() === "yes" ||
  String(value).toLowerCase() === "on";

const pythonRepr = (value: unknown): string => {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === true) return "True";
  if (value === false) return "False";
  if (value === null || value === undefined) return "None";
  return String(value);
};

const extractText = (result: VendorCallResult, label: string): string => {
  const body = result.content
    .map((content) => (typeof content.text === "string" ? content.text : ""))
    .filter(Boolean)
    .join("\n");
  return body ? `### ${label}\n${body}` : `### ${label}: done`;
};

const safeResult = (result: VendorCallResult): BrowserToolResult =>
  result.isError ? textResult(GENERIC_BROWSER_ERROR, true) : result;

export class BrowserToolsRouter {
  constructor(
    private readonly resolver: ProfileResolver,
    private readonly pool: RuntimePool,
    private readonly lifecycle: BrowserLifecycle,
  ) {}

  listTools(): VendorTool[] {
    return visibleTools(process.env[ALLOW_UNSAFE_ENV] === "1");
  }

  async call(
    name: string,
    arguments_: JsonObject = {},
  ): Promise<BrowserToolResult> {
    const args = asObject(arguments_);
    const profile = args.profile;
    if (typeof profile !== "string" || profile.length === 0)
      return textResult("missing required argument: profile", true);
    if (!isManifestTool(name)) return textResult(GENERIC_BROWSER_ERROR, true);
    if (name === UNSAFE_TOOL_NAME && process.env[ALLOW_UNSAFE_ENV] !== "1")
      return textResult(
        `${name} is disabled: JavaScript execution is RCE-equivalent. Set ${ALLOW_UNSAFE_ENV}=1 to allow.`,
        true,
      );

    if (name === "browser_close") {
      try {
        return textResult(JSON.stringify(await this.lifecycle.stop(profile)));
      } catch {
        return textResult(GENERIC_STOP_ERROR, true);
      }
    }

    try {
      const { relayCdpUrl } = await this.resolver.resolve(profile);
      if (name === "browser_fill_form")
        return await this.pool.call(profile, relayCdpUrl, (runtime) =>
          this.fillForm(runtime, args),
        );
      if (name === "browser_select_option")
        return await this.pool.call(profile, relayCdpUrl, (runtime) =>
          this.selectOption(runtime, args),
        );
      const forwarded = { ...args };
      delete forwarded.profile;
      if (name === "browser_type") forwarded.slowly = true;
      return await this.pool.call(profile, relayCdpUrl, async (runtime) =>
        safeResult(await runtime.callTool(name, forwarded)),
      );
    } catch (error) {
      if (error instanceof ProfileNotRunningError)
        return textResult("PROFILE_NOT_RUNNING", true);
      return textResult(GENERIC_BROWSER_ERROR, true);
    }
  }

  private async fillForm(
    runtime: {
      callTool(name: string, args: JsonObject): Promise<VendorCallResult>;
    },
    args: JsonObject,
  ): Promise<BrowserToolResult> {
    const fields = Array.isArray(args.fields) ? args.fields : [];
    const outputs: string[] = [];
    for (const rawField of fields) {
      if (!rawField || typeof rawField !== "object" || Array.isArray(rawField))
        return textResult("humanized fill_form fields must be objects", true);
      const field = rawField as JsonObject;
      const target = field.target;
      const label = field.element || field.name || target;
      const type = field.type;
      const value = field.value ?? "";
      let result: VendorCallResult | undefined;
      if (type === "textbox") {
        result = await runtime.callTool("browser_type", {
          target,
          element: label,
          text: value,
          slowly: true,
        });
      } else if (type === "checkbox" || type === "radio") {
        if (!isTruthyPython(value)) {
          outputs.push(
            `### ${String(label)}: skipped (value ${pythonRepr(value)})`,
          );
          continue;
        }
        result = await runtime.callTool("browser_click", {
          target,
          element: label,
        });
      } else if (type === "combobox") {
        result = await this.selectOptionLocked(runtime, {
          target,
          element: label,
          values: [value],
        });
      } else {
        outputs.push(
          `### ${String(label)}: field type '${String(type)}' not supported in humanized fill_form — use browser_press_key`,
        );
        continue;
      }
      outputs.push(extractText(result, String(label)));
      if (result.isError) return textResult(GENERIC_BROWSER_ERROR, true);
    }
    return { content: [{ type: "text", text: outputs.join("\n") }] };
  }

  private async selectOption(
    runtime: {
      callTool(name: string, args: JsonObject): Promise<VendorCallResult>;
    },
    args: JsonObject,
  ): Promise<BrowserToolResult> {
    const values = Array.isArray(args.values) ? args.values : [];
    if (values.length !== 1 || typeof values[0] !== "string")
      return textResult(
        "humanized select_option supports exactly one value (focus + keyboard prefix + Enter)",
        true,
      );
    return this.selectOptionLocked(runtime, args);
  }

  private async selectOptionLocked(
    runtime: {
      callTool(name: string, args: JsonObject): Promise<VendorCallResult>;
    },
    args: JsonObject,
  ): Promise<BrowserToolResult> {
    const values = Array.isArray(args.values) ? args.values : [];
    if (values.length !== 1 || typeof values[0] !== "string")
      return textResult(
        "humanized select_option requires exactly one string value",
        true,
      );
    const target = args.target;
    const label = args.element || target;
    const click = await runtime.callTool("browser_click", {
      target,
      element: label,
    });
    if (click.isError) return textResult(GENERIC_BROWSER_ERROR, true);
    const typed = await runtime.callTool("browser_type", {
      target,
      element: label,
      text: values[0],
      slowly: true,
    });
    if (typed.isError) return textResult(GENERIC_BROWSER_ERROR, true);
    return safeResult(
      await runtime.callTool("browser_press_key", { key: "Enter" }),
    );
  }

}

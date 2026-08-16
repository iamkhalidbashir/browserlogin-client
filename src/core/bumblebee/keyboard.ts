import { sleepWithSignal, throwIfAborted } from "./types";
import type { CdpSender, Clock, RandomSource } from "./types";

const SHIFTED: Record<string, string> = {
  "1": "!",
  "2": "@",
  "3": "#",
  "4": "$",
  "5": "%",
  "6": "^",
  "7": "&",
  "8": "*",
  "9": "(",
  "0": ")",
  "-": "_",
  "=": "+",
  "[": "{",
  "]": "}",
  "\\": "|",
  ";": ":",
  "'": '"',
  ",": "<",
  ".": ">",
  "/": "?",
  "`": "~",
};
const SPECIAL: Record<
  string,
  { key: string; code: string; vk: number; bit: number }
> = {
  Shift: { key: "Shift", code: "ShiftLeft", vk: 16, bit: 8 },
  Control: { key: "Control", code: "ControlLeft", vk: 17, bit: 2 },
  Alt: { key: "Alt", code: "AltLeft", vk: 18, bit: 1 },
  Meta: { key: "Meta", code: "MetaLeft", vk: 91, bit: 4 },
  Enter: { key: "Enter", code: "Enter", vk: 13, bit: 0 },
  Backspace: { key: "Backspace", code: "Backspace", vk: 8, bit: 0 },
  Tab: { key: "Tab", code: "Tab", vk: 9, bit: 0 },
  Escape: { key: "Escape", code: "Escape", vk: 27, bit: 0 },
  Delete: { key: "Delete", code: "Delete", vk: 46, bit: 0 },
  " ": { key: " ", code: "Space", vk: 32, bit: 0 },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", vk: 38, bit: 0 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", vk: 40, bit: 0 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", vk: 37, bit: 0 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", vk: 39, bit: 0 },
  Home: { key: "Home", code: "Home", vk: 36, bit: 0 },
  End: { key: "End", code: "End", vk: 35, bit: 0 },
  PageUp: { key: "PageUp", code: "PageUp", vk: 33, bit: 0 },
  PageDown: { key: "PageDown", code: "PageDown", vk: 34, bit: 0 },
};

export type KeyboardOptions = {
  clock?: Clock;
  keyHoldMs?: number;
  interCharMs?: number;
  rng?: RandomSource;
  typingPauseChance?: number;
  typingPauseRange?: readonly [number, number];
};

export class HumanKeyboard {
  private modifiers = 0;
  private readonly swallowed = new Set<string>();
  private readonly clock: Clock;
  constructor(
    private readonly sender: CdpSender,
    private readonly sessionId: string | undefined,
    options: KeyboardOptions = {},
  ) {
    this.clock = options.clock ?? { sleep: async () => {} };
    this.keyHoldMs = options.keyHoldMs ?? 0;
    this.interCharMs = options.interCharMs ?? 0;
    this.rng = options.rng ?? Math.random;
    this.typingPauseChance = options.typingPauseChance ?? 0.15;
    this.typingPauseRange = options.typingPauseRange ?? [500, 1200];
  }
  private readonly keyHoldMs: number;
  private readonly interCharMs: number;
  private readonly rng: RandomSource;
  private readonly typingPauseChance: number;
  private readonly typingPauseRange: readonly [number, number];
  private characterStarted = false;

  async dispatch(
    params: Record<string, unknown>,
    sessionId = this.sessionId,
    signal?: AbortSignal,
  ): Promise<void> {
    throwIfAborted(signal);
    await this.sender.send(
      "Input.dispatchKeyEvent",
      {
        ...params,
        modifiers:
          typeof params.modifiers === "number"
            ? params.modifiers
            : this.modifiers,
      },
      sessionId,
    );
    throwIfAborted(signal);
    if (params.type === "rawKeyDown" || params.type === "keyDown")
      await sleepWithSignal(
        this.clock,
        this.keyHoldMs * (0.67 + this.rng() * 0.83),
        signal,
      );
    if (params.type === "keyUp")
      this.modifiers =
        typeof params.modifiers === "number"
          ? params.modifiers
          : this.modifiers;
  }

  async typeText(
    text: string,
    sessionId = this.sessionId,
    signal?: AbortSignal,
  ): Promise<void> {
    let first = true;
    for (const char of [...text]) {
      throwIfAborted(signal);
      if (!first) await this.interCharacterDelay(signal);
      await this.sender.send("Input.insertText", { text: char }, sessionId);
      throwIfAborted(signal);
      first = false;
    }
  }

  async typeCharacter(
    params: Record<string, unknown>,
    sessionId = this.sessionId,
    signal?: AbortSignal,
  ): Promise<void> {
    if (this.characterStarted) await this.interCharacterDelay(signal);
    const keyDown: Record<string, unknown> = { ...params, type: "keyDown" };
    const keyUp: Record<string, unknown> = { ...params, type: "keyUp" };
    delete keyUp.text;
    await this.dispatch(keyDown, sessionId, signal);
    await this.dispatch(keyUp, sessionId, signal);
    this.characterStarted = true;
  }

  private async interCharacterDelay(signal?: AbortSignal): Promise<void> {
    const delay =
      this.rng() < this.typingPauseChance
        ? this.typingPauseRange[0] +
          this.rng() * (this.typingPauseRange[1] - this.typingPauseRange[0])
        : Math.max(
            10,
            this.interCharMs + (this.rng() - 0.5) * this.interCharMs,
          );
    await sleepWithSignal(this.clock, delay, signal);
  }

  swallowKeyUp(key: string): void {
    this.swallowed.add(key);
  }
  consumeSwallowedKeyUp(key: string): boolean {
    if (!this.swallowed.has(key)) return false;
    this.swallowed.delete(key);
    return true;
  }

  async press(key: string): Promise<void> {
    const special =
      SPECIAL[key] ?? SPECIAL[key[0]?.toUpperCase() + key.slice(1)];
    if (special) {
      this.modifiers |= special.bit;
      await this.dispatch({
        type: special.bit ? "rawKeyDown" : "keyDown",
        key: special.key,
        code: special.code,
        windowsVirtualKeyCode: special.vk,
      });
      return;
    }
    const base = key.length === 1 ? key.toLowerCase() : key;
    const shifted = (this.modifiers & 8) !== 0;
    const produced = shifted ? (SHIFTED[base] ?? base.toUpperCase()) : base;
    await this.dispatch({
      type: "keyDown",
      key: produced,
      code: codeFor(base),
      windowsVirtualKeyCode: vkFor(base),
      ...(this.modifiers & 6 ? {} : { text: produced }),
    });
  }

  async release(key: string): Promise<void> {
    const special =
      SPECIAL[key] ?? SPECIAL[key[0]?.toUpperCase() + key.slice(1)];
    if (special) {
      this.modifiers &= ~special.bit;
      await this.dispatch({
        type: "keyUp",
        key: special.key,
        code: special.code,
        windowsVirtualKeyCode: special.vk,
      });
      return;
    }
    const base = key.length === 1 ? key.toLowerCase() : key;
    await this.dispatch({
      type: "keyUp",
      key: this.modifiers & 8 ? (SHIFTED[base] ?? base.toUpperCase()) : base,
      code: codeFor(base),
      windowsVirtualKeyCode: vkFor(base),
    });
  }
}

function codeFor(key: string): string {
  if (/^[a-z]$/.test(key)) return `Key${key.toUpperCase()}`;
  if (/^\d$/.test(key)) return `Digit${key}`;
  return (
    { " ": "Space", ".": "Period", ",": "Comma", "/": "Slash" }[key] ?? key
  );
}
function vkFor(key: string): number {
  return key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0;
}

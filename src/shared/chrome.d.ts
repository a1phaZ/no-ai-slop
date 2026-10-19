interface StorageChange {
  oldValue?: unknown;
  newValue?: unknown;
}

interface StorageArea {
  get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  clear(): Promise<void>;
}

interface ChromeStorage {
  sync: StorageArea;
  local: StorageArea;
  onChanged: {
    addListener(
      cb: (changes: Record<string, StorageChange>, area: string) => void,
    ): void;
  };
}

interface ChromeRuntime {
  sendMessage(message: unknown): Promise<unknown>;
  onMessage: {
    addListener(
      cb: (
        message: unknown,
        sender: unknown,
        sendResponse: (response?: unknown) => void,
      ) => boolean | void,
    ): void;
  };
  getURL(path: string): string;
  openOptionsPage(): Promise<void>;
  onInstalled: { addListener(cb: () => void): void };
  lastError?: { message?: string };
}

interface ChromeAction {
  setBadgeText(details: { text: string }): Promise<void>;
  setBadgeBackgroundColor(details: { color: string }): Promise<void>;
  setTitle(details: { title: string }): Promise<void>;
}

interface ChromeTabs {
  create(details: { url: string }): Promise<unknown>;
}

interface ChromeApi {
  storage: ChromeStorage;
  runtime: ChromeRuntime;
  action: ChromeAction;
  tabs: ChromeTabs;
}

declare const chrome: ChromeApi;

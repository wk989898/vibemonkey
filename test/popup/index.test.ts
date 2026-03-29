import { beforeEach, expect, test, vi } from "vitest";

const { renderMock, showUnhandledErrorMock } = vi.hoisted(() => ({
  renderMock: vi.fn(),
  showUnhandledErrorMock: vi.fn(),
}));

vi.mock("@/common/ui", () => ({
  EXTERNAL_LINK_PROPS: {},
  getActiveElement: () => document.activeElement,
  isTouch: false,
  render: renderMock,
  showUnhandledError: showUnhandledErrorMock,
}));

vi.mock("@/common/ui/style", () => ({}));
vi.mock("@/common/load-script-icon", () => ({
  loadCommandIcon: vi.fn(),
  loadScriptIcon: vi.fn(),
}));
vi.mock("@/popup/views/app.vue", () => ({
  default: {},
}));

beforeEach(() => {
  vi.resetModules();
  renderMock.mockReset();
  showUnhandledErrorMock.mockReset();
  document.body.innerHTML = "";
  Object.assign(browser.runtime, {
    onMessage: {
      addListener: vi.fn(),
    },
  });
});

test("popup retries InitPopup until the background responds", async () => {
  let initPopupAttempts = 0;
  const port = {
    onDisconnect: {
      addListener: vi.fn(),
    },
    onMessage: {
      addListener: vi.fn(),
    },
  };
  const sendMessage = vi.fn(async ({ cmd }) => {
    if (cmd === "GetAllOptions") {
      return {
        filtersPopup: {
          enabledFirst: false,
          groupRunAt: false,
          hideDisabled: false,
          sort: "exec",
        },
        isApplied: true,
        popupWidth: 320,
        updateEnabledScriptsOnly: false,
      };
    }
    if (cmd === "InitPopup") {
      initPopupAttempts += 1;
      if (initPopupAttempts === 1) {
        throw new Error("Receiving end does not exist.");
      }
      return [
        null,
        {
          domain: "example.com",
          injectable: true,
          tab: {
            id: 1,
            url: "https://example.com/",
          },
        },
        ["", "", null],
      ];
    }
    return {};
  });
  const connect = vi.fn(() => port);
  Object.assign(browser.runtime, {
    connect,
    sendMessage,
  });

  await import("@/popup/index");

  await vi.waitFor(() => {
    expect(connect).toHaveBeenCalledWith({ name: "Popup::1" });
  });
  expect(sendMessage).toHaveBeenCalledWith({
    cmd: "InitPopup",
    data: null,
  });
  expect(sendMessage.mock.calls.filter(([payload]) => payload.cmd === "InitPopup")).toHaveLength(2);
  expect(renderMock).toHaveBeenCalledTimes(1);
  expect(showUnhandledErrorMock).not.toHaveBeenCalled();
  expect(port.onMessage.addListener).toHaveBeenCalledOnce();
});

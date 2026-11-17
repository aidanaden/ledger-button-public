import { DeviceStatus } from "@ledgerhq/device-management-kit";
import { Maybe, Nothing } from "purify-ts";
import { of, Subject } from "rxjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BlockchainFamily } from "./blockchain-provider/model/types";
import type { Account } from "./model/Account";
import { blockchainProviderModuleTypes } from "../internal/blockchain-provider/di/blockchainProviderModuleTypes";
import { contextModuleTypes } from "../internal/context/di/contextModuleTypes";
import { currencyModuleTypes } from "../internal/currency/di/currencyModuleTypes";
import { deviceModuleTypes } from "../internal/device/di/deviceModuleTypes";
import { eventTrackingModuleTypes } from "../internal/event-tracking/di/eventTrackingModuleTypes";
import { ledgerSyncModuleTypes } from "../internal/ledgersync/di/ledgerSyncModuleTypes";
import { loggerModuleTypes } from "../internal/logger/di/loggerModuleTypes";
import { modalModuleTypes } from "../internal/modal/di/modalModuleTypes";
import { navigationModuleTypes } from "../internal/navigation/di/navigationModuleTypes";
import { platformModuleTypes } from "../internal/platform/di/platformModuleTypes";
import { storageModuleTypes } from "../internal/storage/di/storageModuleTypes";
import { LedgerButtonCore } from "./LedgerButtonCore";

// Mock the DI container factory so the constructor wires our stubs instead of
// the real graph.
const hoisted = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  container: undefined as any,
  createContainer: vi.fn(),
}));
vi.mock("../internal/di/di", () => ({
  createContainer: hoisted.createContainer,
}));

describe("LedgerButtonCore", () => {
  let trackOpened: { execute: ReturnType<typeof vi.fn> };
  let trackActivated: { execute: ReturnType<typeof vi.fn> };
  let selectedAccounts: Map<BlockchainFamily, Account>;
  let authResponse: unknown;
  let contextService: {
    getContext: ReturnType<typeof vi.fn>;
    onEvent: ReturnType<typeof vi.fn>;
  };
  let storage: {
    removeSelectedAccount: ReturnType<typeof vi.fn>;
    resetStorage: ReturnType<typeof vi.fn>;
    getTrustChainId: ReturnType<typeof vi.fn>;
    isTrustChainValid: ReturnType<typeof vi.fn>;
    getSelectedAccounts: ReturnType<typeof vi.fn>;
    isWelcomeScreenCompleted: ReturnType<typeof vi.fn>;
    getUserConsent: ReturnType<typeof vi.fn>;
    hasDeveloperMode: ReturnType<typeof vi.fn>;
  };
  let blockchainProviderManager: {
    describeCurrency: ReturnType<typeof vi.fn>;
    setSelectedAccounts: ReturnType<typeof vi.fn>;
  };
  let connectDevice: { execute: ReturnType<typeof vi.fn> };
  let disconnectDevice: { execute: ReturnType<typeof vi.fn> };
  let switchDevice: { execute: ReturnType<typeof vi.fn> };
  let deviceSessionState$: Subject<{ deviceStatus: DeviceStatus }>;
  let deviceService: {
    connectedDevice?: { sessionId: string };
    sessionId?: string;
    dmk: {
      close: ReturnType<typeof vi.fn>;
      getDeviceSessionState: ReturnType<typeof vi.fn>;
    };
  };

  const createCore = ({
    initialization = Promise.resolve(),
  }: { initialization?: Promise<void> } = {}) => {
    trackOpened = { execute: vi.fn() };
    trackActivated = { execute: vi.fn().mockResolvedValue(undefined) };
    connectDevice = {
      execute: vi.fn().mockResolvedValue({ sessionId: "new-session" }),
    };
    disconnectDevice = { execute: vi.fn().mockResolvedValue(undefined) };
    switchDevice = {
      execute: vi.fn().mockResolvedValue({ sessionId: "switched-session" }),
    };
    deviceSessionState$ = new Subject();
    deviceService = {
      dmk: {
        close: vi.fn(),
        getDeviceSessionState: vi.fn(() => deviceSessionState$),
      },
    };

    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
    };

    contextService = {
      getContext: vi.fn(() => ({
        selectedAccounts,
        connectedDevice: undefined,
      })),
      onEvent: vi.fn(),
    };

    storage = {
      removeSelectedAccount: vi.fn(),
      resetStorage: vi.fn(),
      getTrustChainId: vi.fn(() => Nothing),
      isTrustChainValid: vi.fn(() => false),
      getSelectedAccounts: vi.fn(() => new Map()),
      isWelcomeScreenCompleted: vi.fn().mockResolvedValue(false),
      getUserConsent: vi.fn().mockResolvedValue(Nothing),
      hasDeveloperMode: vi.fn(() => false),
    };

    blockchainProviderManager = {
      describeCurrency: vi.fn(() => Maybe.empty()),
      setSelectedAccounts: vi.fn(),
    };

    const ledgerSyncService = {
      authenticate: vi.fn(() => of(authResponse)),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const registry = new Map<symbol, any>([
      [loggerModuleTypes.LoggerPublisher, () => logger],
      [modalModuleTypes.ModalService, {}],
      [contextModuleTypes.ContextService, contextService],
      [navigationModuleTypes.NavigationIntentService, { observe: vi.fn() }],
      [ledgerSyncModuleTypes.LedgerSyncService, ledgerSyncService],
      [storageModuleTypes.StorageService, storage],
      [deviceModuleTypes.DeviceManagementKitService, deviceService],
      [deviceModuleTypes.ConnectDeviceUseCase, connectDevice],
      [deviceModuleTypes.DisconnectDeviceUseCase, disconnectDevice],
      [deviceModuleTypes.SwitchDeviceUseCase, switchDevice],
      [eventTrackingModuleTypes.TrackLedgerSyncOpenedUseCase, trackOpened],
      [eventTrackingModuleTypes.TrackLedgerSyncActivatedUseCase, trackActivated],
      [
        blockchainProviderModuleTypes.BlockchainProviderManager,
        blockchainProviderManager,
      ],
      [platformModuleTypes.IsMobileUseCase, { execute: vi.fn(() => false) }],
      [
        currencyModuleTypes.CurrencyService,
        { initialize: vi.fn().mockResolvedValue("USD") },
      ],
    ]);

    hoisted.container = {
      get: vi.fn((token: symbol) => registry.get(token)),
      unbindAll: vi.fn().mockResolvedValue(undefined),
    };
    hoisted.createContainer.mockReturnValue(hoisted.container);

    // Skip the one-time wiring (providers, pending-tx controller). Session
    // reset still runs restoreContext against the stubs above.
    vi.spyOn(
      LedgerButtonCore.prototype as unknown as {
        initializeContext: () => void;
      },
      "initializeContext",
    ).mockReturnValue(initialization as never);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new LedgerButtonCore({} as any);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    selectedAccounts = new Map();
    authResponse = { trustChainId: "tc-1", applicationPath: "m/0'" };
  });

  describe("connectToLedgerSync - event tracking", () => {
    it("tracks open + activated when no account is selected (onboarding)", () => {
      const core = createCore();

      core.connectToLedgerSync().subscribe();

      expect(trackOpened.execute).toHaveBeenCalledTimes(1);
      expect(trackActivated.execute).toHaveBeenCalledTimes(1);
    });

    it("skips both events when an account is already selected", () => {
      selectedAccounts = new Map([
        ["ethereum", { currencyId: "ethereum" } as Account],
      ]);
      const core = createCore();

      core.connectToLedgerSync().subscribe();

      expect(trackOpened.execute).not.toHaveBeenCalled();
      expect(trackActivated.execute).not.toHaveBeenCalled();
    });

    it("skips both events when an account of any family is selected", () => {
      selectedAccounts = new Map([
        ["solana", { currencyId: "solana" } as Account],
      ]);
      const core = createCore();

      core.connectToLedgerSync().subscribe();

      expect(trackOpened.execute).not.toHaveBeenCalled();
      expect(trackActivated.execute).not.toHaveBeenCalled();
    });
  });

  describe("disconnect", () => {
    it("removes only the given family's account when others remain", async () => {
      selectedAccounts = new Map([
        ["ethereum", { currencyId: "ethereum" } as Account],
        ["solana", { currencyId: "solana" } as Account],
      ]);
      const core = createCore();

      await core.disconnect("ethereum");

      expect(storage.removeSelectedAccount).toHaveBeenCalledWith("ethereum");
      expect(contextService.onEvent).toHaveBeenCalledWith({
        type: "account_disconnected",
        family: "ethereum",
      });
      // no full session reset while another family is still selected
      expect(storage.resetStorage).not.toHaveBeenCalled();
    });

    it("resets the session when the last selected account is removed", async () => {
      selectedAccounts = new Map([
        ["ethereum", { currencyId: "ethereum" } as Account],
      ]);
      const core = createCore();

      await core.disconnect("ethereum");

      expect(storage.resetStorage).toHaveBeenCalledTimes(1);
      expect(storage.removeSelectedAccount).not.toHaveBeenCalled();
      expect(contextService.onEvent).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "account_disconnected" }),
      );
    });

    it("resets the session when called with no family", async () => {
      selectedAccounts = new Map([
        ["ethereum", { currencyId: "ethereum" } as Account],
        ["solana", { currencyId: "solana" } as Account],
      ]);
      const core = createCore();

      await core.disconnect();

      expect(storage.resetStorage).toHaveBeenCalledTimes(1);
      expect(storage.removeSelectedAccount).not.toHaveBeenCalled();
    });

    it("keeps the same container so the provider held by the dApp stays live", async () => {
      const core = createCore();

      await core.disconnect();

      expect(hoisted.createContainer).toHaveBeenCalledTimes(1);
    });

    it("releases the device through disconnect rather than closing DMK", async () => {
      const core = createCore();

      await core.disconnect();

      expect(disconnectDevice.execute).toHaveBeenCalledTimes(1);
      // dmk.close() drops the session without emitting NOT_CONNECTED, leaving
      // our listeners convinced the device is still there.
      expect(deviceService.dmk.close).not.toHaveBeenCalled();
    });

    it("rebuilds the context once the session state is cleared", async () => {
      const core = createCore();

      await core.disconnect();

      expect(contextService.onEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: "initialize_context" }),
      );
      const [resetOrder] = storage.resetStorage.mock.invocationCallOrder;
      const initializeIndex = contextService.onEvent.mock.calls.findIndex(
        (call) =>
          (call[0] as { type: string } | undefined)?.type ===
          "initialize_context",
      );
      expect(resetOrder).toBeLessThan(
        contextService.onEvent.mock.invocationCallOrder[initializeIndex] as number,
      );
    });

    it("still resets when the device cannot be released", async () => {
      const core = createCore();
      disconnectDevice.execute.mockRejectedValue(new Error("device is gone"));

      await core.disconnect();

      expect(storage.resetStorage).toHaveBeenCalledTimes(1);
      expect(contextService.onEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: "initialize_context" }),
      );
    });

    it("restores a valid session's accounts onto the live providers", async () => {
      const ethereumAccount = { currencyId: "ethereum" } as Account;
      const restored = new Map<BlockchainFamily, Account>([
        ["ethereum", ethereumAccount],
      ]);
      const core = createCore();
      storage.getTrustChainId.mockReturnValue(Maybe.of("tc-1"));
      storage.isTrustChainValid.mockReturnValue(true);
      storage.getSelectedAccounts.mockReturnValue(restored);
      storage.getUserConsent.mockResolvedValue(
        Maybe.of({ consentGiven: true }),
      );
      blockchainProviderManager.describeCurrency.mockReturnValue(
        Maybe.of({ networkId: "137" }),
      );

      await core.disconnect();

      expect(
        blockchainProviderManager.setSelectedAccounts,
      ).toHaveBeenCalledWith(restored);
      expect(contextService.onEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "initialize_context",
          context: expect.objectContaining({
            selectedAccounts: restored,
            trustChainId: "tc-1",
            chainId: 137,
            hasTrackingConsent: true,
          }),
        }),
      );
    });

    it("drops an expired trust chain before restoring context", async () => {
      const core = createCore();
      storage.getTrustChainId.mockReturnValue(Maybe.of("tc-expired"));
      storage.isTrustChainValid.mockReturnValue(false);

      await core.disconnect();

      expect(storage.resetStorage).toHaveBeenCalledTimes(2);
      expect(
        blockchainProviderManager.setSelectedAccounts,
      ).toHaveBeenCalledWith(new Map());
    });
  });

  describe("device session lifecycle", () => {
    it("disconnects a stale DMK session before reconnecting", async () => {
      const core = createCore();
      deviceService.sessionId = "stale-session";

      await core.connectToDevice("usb");

      expect(disconnectDevice.execute).toHaveBeenCalledOnce();
      expect(connectDevice.execute).toHaveBeenCalledWith({ type: "usb" });
      expect(disconnectDevice.execute.mock.invocationCallOrder[0]).toBeLessThan(
        connectDevice.execute.mock.invocationCallOrder[0],
      );
    });

    it("cleans the DMK session when the device disconnects physically", async () => {
      const core = createCore();
      deviceService.connectedDevice = { sessionId: "session-1" };
      connectDevice.execute.mockImplementation(async () => {
        deviceService.connectedDevice = { sessionId: "session-1" };
        return { sessionId: "session-1" };
      });

      await core.connectToDevice("usb");
      disconnectDevice.execute.mockClear();
      deviceSessionState$.next({
        deviceStatus: DeviceStatus.NOT_CONNECTED,
      });

      await vi.waitFor(() => {
        expect(disconnectDevice.execute).toHaveBeenCalledOnce();
        expect(contextService.onEvent).toHaveBeenCalledWith({
          type: "device_disconnected",
        });
      });
    });

    it("waits for the disconnect cleanup before reconnecting", async () => {
      const core = createCore();
      deviceService.connectedDevice = { sessionId: "session-1" };
      connectDevice.execute.mockImplementation(async () => {
        deviceService.connectedDevice = { sessionId: "session-1" };
        return { sessionId: "session-1" };
      });
      await core.connectToDevice("usb");

      let resolveCleanup: () => void = () => undefined;
      disconnectDevice.execute.mockReturnValue(
        new Promise<void>((resolve) => {
          resolveCleanup = resolve;
        }),
      );
      deviceService.connectedDevice = undefined;
      deviceSessionState$.next({ deviceStatus: DeviceStatus.NOT_CONNECTED });
      connectDevice.execute.mockClear();

      const pendingConnect = core.connectToDevice("usb");
      await Promise.resolve();
      expect(connectDevice.execute).not.toHaveBeenCalled();

      resolveCleanup();
      await pendingConnect;

      expect(connectDevice.execute).toHaveBeenCalledWith({ type: "usb" });
    });

    it("still connects when releasing the previous session fails", async () => {
      const core = createCore();
      deviceService.sessionId = "session-1";
      disconnectDevice.execute.mockRejectedValue(
        new Error("no matching device connection found"),
      );

      await core.connectToDevice("usb");

      expect(connectDevice.execute).toHaveBeenCalledWith({ type: "usb" });
    });
  });

  describe("dispose", () => {
    it("closes DMK and unbinds the container", async () => {
      const core = createCore();

      await core.dispose();

      expect(deviceService.dmk.close).toHaveBeenCalledOnce();
      expect(hoisted.container.unbindAll).toHaveBeenCalledOnce();
    });

    it("stops reacting to the device once disposed", async () => {
      const core = createCore();
      connectDevice.execute.mockImplementation(async () => {
        deviceService.connectedDevice = { sessionId: "session-1" };
        return { sessionId: "session-1" };
      });
      await core.connectToDevice("usb");
      disconnectDevice.execute.mockClear();

      await core.dispose();
      deviceSessionState$.next({ deviceStatus: DeviceStatus.NOT_CONNECTED });

      expect(disconnectDevice.execute).not.toHaveBeenCalled();
    });

    it("waits for initialization before releasing anything", async () => {
      let finishInitialization: () => void = () => undefined;
      const core = createCore({
        initialization: new Promise<void>((resolve) => {
          finishInitialization = resolve;
        }),
      });

      const disposal = core.dispose();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(deviceService.dmk.close).not.toHaveBeenCalled();
      expect(hoisted.container.unbindAll).not.toHaveBeenCalled();

      finishInitialization();
      await disposal;

      expect(deviceService.dmk.close).toHaveBeenCalledOnce();
    });

    it("still releases everything when initialization failed", async () => {
      const core = createCore({
        initialization: Promise.reject(new Error("dApp config unavailable")),
      });

      await expect(core.ready).rejects.toThrow("dApp config unavailable");
      await expect(core.dispose()).resolves.toBeUndefined();

      expect(deviceService.dmk.close).toHaveBeenCalledOnce();
      expect(hoisted.container.unbindAll).toHaveBeenCalledOnce();
    });

    it("waits for a connection in progress before closing DMK", async () => {
      const core = createCore();
      let finishConnection: () => void = () => undefined;
      connectDevice.execute.mockImplementation(
        () =>
          new Promise((resolve) => {
            finishConnection = () => {
              deviceService.connectedDevice = { sessionId: "session-1" };
              resolve({ sessionId: "session-1" });
            };
          }),
      );
      const connection = core.connectToDevice("usb");

      const disposal = core.dispose();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(deviceService.dmk.close).not.toHaveBeenCalled();

      finishConnection();
      await connection;
      await disposal;
      deviceSessionState$.next({ deviceStatus: DeviceStatus.NOT_CONNECTED });

      expect(deviceService.dmk.close).toHaveBeenCalledOnce();
      expect(disconnectDevice.execute).not.toHaveBeenCalled();
    });

    it("waits for every connection in progress before closing DMK", async () => {
      const core = createCore();
      const finishers: (() => void)[] = [];
      const pending = () =>
        new Promise((resolve) => {
          finishers.push(() => resolve({ sessionId: "session" }));
        });
      connectDevice.execute.mockImplementation(pending);
      switchDevice.execute.mockImplementation(pending);
      const first = core.connectToDevice("usb");
      await new Promise((resolve) => setTimeout(resolve, 0));
      const switched = core.switchDevice("bluetooth");
      const second = core.connectToDevice("usb");
      await new Promise((resolve) => setTimeout(resolve, 0));

      const disposal = core.dispose();
      finishers.slice(1).forEach((finish) => finish());
      await Promise.all([switched, second]);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(deviceService.dmk.close).not.toHaveBeenCalled();

      finishers[0]();
      await Promise.all([first, disposal]);

      expect(deviceService.dmk.close).toHaveBeenCalledOnce();
    });

    it("rejects a device switch that starts after dispose", async () => {
      const core = createCore();
      void core.dispose();

      await expect(core.switchDevice("usb")).rejects.toThrow(
        "LedgerButtonCore is disposed",
      );
      expect(switchDevice.execute).not.toHaveBeenCalled();
    });

    it("rejects a connection that starts after dispose", async () => {
      const core = createCore();
      void core.dispose();

      await expect(core.connectToDevice("usb")).rejects.toThrow(
        "LedgerButtonCore is disposed",
      );
      expect(connectDevice.execute).not.toHaveBeenCalled();
    });

    it("releases only once when called again", async () => {
      const core = createCore();

      await Promise.all([core.dispose(), core.dispose()]);

      expect(deviceService.dmk.close).toHaveBeenCalledOnce();
      expect(hoisted.container.unbindAll).toHaveBeenCalledOnce();
    });
  });

  describe("active family accessors", () => {
    it("exposes the connected families from the context", () => {
      selectedAccounts = new Map([
        ["ethereum", { currencyId: "ethereum" } as Account],
        ["solana", { currencyId: "solana" } as Account],
      ]);
      const core = createCore();

      expect(core.getConnectedFamilies()).toEqual(["ethereum", "solana"]);
    });

    it("resolves the active family and its selected account", () => {
      const solanaAccount = { currencyId: "solana" } as Account;
      selectedAccounts = new Map([["solana", solanaAccount]]);
      const core = createCore();
      contextService.getContext.mockReturnValue({
        selectedAccounts,
        activeFamily: "solana",
      });

      expect(core.getActiveFamily()).toBe("solana");
      expect(core.getActiveSelectedAccount()).toBe(solanaAccount);
    });

    it("emits an active_family_changed event when switching families", () => {
      selectedAccounts = new Map([
        ["ethereum", { currencyId: "ethereum" } as Account],
        ["solana", { currencyId: "solana" } as Account],
      ]);
      const core = createCore();

      core.setActiveFamily("solana");

      expect(contextService.onEvent).toHaveBeenCalledWith({
        type: "active_family_changed",
        family: "solana",
      });
    });
  });
});

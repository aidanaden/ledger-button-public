import { Container } from "inversify";
import { Right } from "purify-ts";
import { BehaviorSubject } from "rxjs";
import { describe, expect, it, vi } from "vitest";

import type { BlockchainProviderFactory } from "@api/blockchain-provider/model/BlockchainProviderFactory";
import type { Account } from "@api/model/Account";
import { contextModuleTypes } from "@internal/context/di/contextModuleTypes";
import type { DAppConfig } from "@internal/dAppConfig/model/dAppConfigTypes";
import { loggerModuleTypes } from "@internal/logger/di/loggerModuleTypes";
import { storageModuleTypes } from "@internal/storage/di/storageModuleTypes";

import { createMockCoreFacade } from "../__mocks__/coreFacadeMock";
import type { BlockchainProviderManager } from "../service/BlockchainProviderManager";
import { blockchainProviderModuleFactory } from "./blockchainProviderModule";
import { blockchainProviderModuleTypes } from "./blockchainProviderModuleTypes";

type TestContext = {
  selectedAccounts: Map<string, Account>;
  chainId: number;
};

const createContainer = (context$: BehaviorSubject<TestContext>) => {
  const container = new Container();
  container
    .bind(contextModuleTypes.ContextService)
    .toConstantValue({ observeContext: () => context$ });
  container.bind(loggerModuleTypes.LoggerPublisher).toConstantValue(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }));
  container.bind(storageModuleTypes.StorageService).toConstantValue({});
  container.loadSync(blockchainProviderModuleFactory());
  return container;
};

const createProvider = () => ({
  family: "ethereum",
  injectWalletProvider: vi.fn(),
  setSelectedAccount: vi.fn(),
  setNetwork: vi.fn(),
});

describe("blockchainProviderModule", () => {
  it("stops pushing context to the providers once the container is unbound", async () => {
    const context$ = new BehaviorSubject<TestContext>({
      selectedAccounts: new Map(),
      chainId: 1,
    });
    const container = createContainer(context$);
    const provider = createProvider();
    const factory = vi
      .fn()
      .mockReturnValue(Right(provider)) as BlockchainProviderFactory;
    container
      .get<BlockchainProviderManager>(
        blockchainProviderModuleTypes.BlockchainProviderManager,
      )
      .init(
        createMockCoreFacade(),
        { blockchains: [] } as unknown as DAppConfig,
        [factory],
      );
    expect(provider.setNetwork).toHaveBeenLastCalledWith(1);

    await container.unbindAll();
    context$.next({ selectedAccounts: new Map(), chainId: 137 });

    expect(provider.setNetwork).not.toHaveBeenCalledWith(137);
    expect(context$.observed).toBe(false);
  });
});

import { Container } from "inversify";
import { Right } from "purify-ts";
import { BehaviorSubject } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { accountModuleTypes } from "@internal/account/di/accountModuleTypes";
import { contextModuleTypes } from "@internal/context/di/contextModuleTypes";
import { loggerModuleTypes } from "@internal/logger/di/loggerModuleTypes";

import type { PendingTransactionController } from "../controller/PendingTransactionController";
import { pendingTransactionModuleFactory } from "./pendingTransactionModule";
import { pendingTransactionModuleTypes } from "./pendingTransactionModuleTypes";

const pendingTx = { hash: "0x111", chainId: 1 };

const createContainer = (context$: BehaviorSubject<unknown>) => {
  const container = new Container();
  container.loadSync(pendingTransactionModuleFactory());
  container
    .rebindSync(pendingTransactionModuleTypes.PendingTransactionStorageService)
    .toConstantValue({
      getAll: () => [pendingTx],
      add: vi.fn(),
      remove: vi.fn(),
    });
  const confirmPendingTransactions = {
    execute: vi.fn().mockResolvedValue(Right([])),
  };
  container
    .rebindSync(pendingTransactionModuleTypes.ConfirmPendingTransactionsUseCase)
    .toConstantValue(confirmPendingTransactions);
  container
    .rebindSync(
      pendingTransactionModuleTypes.HydratePendingTransactionsWithFiatUseCase,
    )
    .toConstantValue({ execute: vi.fn().mockResolvedValue([]) });
  container.bind(contextModuleTypes.ContextService).toConstantValue({
    observeContext: () => context$,
    getContext: () => context$.value,
  });
  container
    .bind(accountModuleTypes.FetchSelectedAccountUseCase)
    .toConstantValue({ execute: vi.fn().mockResolvedValue(Right({})) });
  container.bind(loggerModuleTypes.LoggerPublisher).toConstantValue(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }));
  return { container, confirmPendingTransactions };
};

describe("pendingTransactionModule", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stops polling and following the context once the container is unbound", async () => {
    vi.useFakeTimers();
    const context$ = new BehaviorSubject<unknown>({
      selectedAccounts: new Map(),
    });
    const { container, confirmPendingTransactions } = createContainer(context$);
    container
      .get<PendingTransactionController>(
        pendingTransactionModuleTypes.PendingTransactionController,
      )
      .track();

    await container.unbindAll();
    context$.next({
      selectedAccounts: new Map([["ethereum", { ticker: "ETH" }]]),
      activeFamily: "ethereum",
    });
    await vi.advanceTimersByTimeAsync(30_000);

    expect(confirmPendingTransactions.execute).not.toHaveBeenCalled();
    expect(context$.observed).toBe(false);
  });
});

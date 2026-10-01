import { Router, type IRouter } from "express";
import healthRouter from "./health";
import legacyAuthRouter from "./legacyAuth";
import boostlyRouter from "./boostly";
import legacyDataRouter from "./legacyData";
import legacyProvidersRouter from "./legacyProviders";
import legacyMutationsRouter from "./legacyMutations";
import legacyRpcRouter from "./legacyRpc";
import legacyEngagementOrdersRouter from "./legacyEngagementOrders";
import adminProviderAccountsRouter from "./adminProviderAccounts";

const router: IRouter = Router();

router.use(healthRouter);
router.use(legacyAuthRouter);
router.use(boostlyRouter);
router.use(legacyDataRouter);
router.use(legacyProvidersRouter);
router.use(legacyMutationsRouter);
router.use(legacyRpcRouter);
router.use(legacyEngagementOrdersRouter);
router.use(adminProviderAccountsRouter);

export default router;

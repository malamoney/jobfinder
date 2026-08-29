import type { BoardAddress } from "@/operations";
import { WORKDAY_TENANTS } from "@/sources/workday-tenants";

/**
 * The Workday tenants a nightly sweep covers (#16).
 *
 * Workday is a hand-picked short list, never harvested: a detail request per
 * job makes it ~100× the per-Board request cost of any other Source (ADR
 * 0003). The list is the keys of `WORKDAY_TENANTS` — the registry that also
 * holds each tenant's shard, site, and search — so a tenant is added in one
 * place and both the sweep and the adapter see it.
 *
 * A tenant whose shard or site is wrong fails its seed probe and is added
 * disabled, to be enabled once its configuration is corrected.
 */
export const WORKDAY_BOARDS: BoardAddress[] = Object.keys(WORKDAY_TENANTS).map(
  (slug) => ({ source: "workday", slug }),
);

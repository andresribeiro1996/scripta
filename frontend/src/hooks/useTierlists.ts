// Shared read/mutate access to the account's tier lists — mirrors
// useMurals.ts (a useQuery over one list, plain mutate-then-cache-set
// helpers), with each mutation targeting ONE tier list by id. No scrub
// helpers here: tier-list documents reference books by key only, and
// that cleanup is Task 6's concern, not this hook's.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createTierlistApi,
  deleteTierlistApi,
  fetchTierlists,
  updateTierlistApi,
  type Tierlist,
  type TierlistData
} from "../api/tierlists";

export function useTierlists() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["tierlists"], queryFn: fetchTierlists });

  function current(): Tierlist[] {
    return queryClient.getQueryData<Tierlist[]>(["tierlists"]) ?? [];
  }

  function setTierlists(tierlists: Tierlist[]) {
    queryClient.setQueryData(["tierlists"], tierlists);
  }

  function replaceOne(updated: Tierlist) {
    setTierlists(current().map((t) => (t.id === updated.id ? updated : t)));
  }

  async function create(name: string): Promise<Tierlist> {
    const created = await createTierlistApi(name);
    setTierlists([...current(), created]);
    return created;
  }

  async function rename(id: string, name: string): Promise<Tierlist> {
    const updated = await updateTierlistApi(id, { name });
    replaceOne(updated);
    return updated;
  }

  async function saveData(id: string, data: TierlistData): Promise<Tierlist> {
    const updated = await updateTierlistApi(id, { data });
    replaceOne(updated);
    return updated;
  }

  async function remove(id: string): Promise<void> {
    await deleteTierlistApi(id);
    setTierlists(current().filter((t) => t.id !== id));
  }

  return { ...query, create, rename, saveData, remove };
}

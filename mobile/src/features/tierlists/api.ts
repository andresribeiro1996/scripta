import { createTierlistsApi } from "@scripta/shared";
import { File, Paths } from "expo-file-system";
import { apiClient, request } from "../../core/api";

export type { BallotResponse, Tierlist, VotedTierlist, VotingBoard } from "@scripta/shared";

export const {
  fetchTierlists,
  createTierlist,
  updateTierlist,
  deleteTierlist,
  fetchVotedTierlists,
  fetchVotingBoard,
  submitBallot,
  fetchBallot,
  fetchMyBallot,
  openVoting,
  setVotingState,
  fetchTierlistResults,
} = createTierlistsApi(request);

export async function renderTierlistShareVideo(id: string, imageUri: string) {
  const form = new FormData();
  form.append("image", new File(imageUri));
  const { base64 } = await apiClient.request<{ base64: string }>(`/tierlists/${encodeURIComponent(id)}/share-video`, { method: "POST", body: form, auth: true });
  const file = new File(Paths.cache, `tierlist-${id}-${Date.now()}.mp4`);
  file.create();
  file.write(base64, { encoding: "base64" });
  return file.uri;
}

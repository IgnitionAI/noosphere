"use server";

import { revalidatePath } from "next/cache";
import { publishNextIcpVersion, type IcpVersion } from "@/lib/api";

export async function publishCanonicalIcp(
  workspaceSlug: string,
  icpId: string,
  _formData: FormData,
): Promise<IcpVersion> {
  const version = await publishNextIcpVersion(workspaceSlug, icpId);
  revalidatePath(`/w/${workspaceSlug}/icps`);
  revalidatePath(`/w/${workspaceSlug}/icps/${icpId}`);
  return version;
}

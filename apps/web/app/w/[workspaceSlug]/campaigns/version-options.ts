import {
  getAIPolicy,
  getOffer,
  getMessagingStrategy,
  listAIPolicies,
  listIcpVersions,
  listMessagingStrategies,
  listOffers,
  listSequenceVersions,
  listSequences,
  type AIPolicyVersion,
  type IcpVersion,
  type MessagingStrategyVersion,
  type OfferVersion,
  type SequenceVersion,
} from "@/lib/api";

export type PublishedOption = { id: string; version: number; label: string; publishedAt: string };

export async function loadPublishedOptions(workspaceSlug: string) {
  const [icps, offers, strategies, policies, sequences] = await Promise.all([
    listIcpVersions(workspaceSlug),
    listOffers(workspaceSlug),
    listMessagingStrategies(workspaceSlug),
    listAIPolicies(workspaceSlug),
    listSequences(workspaceSlug),
  ]);
  const [offerVersions, strategyVersions, policyVersions, sequenceVersions] = await Promise.all([
    Promise.all(offers.data.map((offer) => getOffer(workspaceSlug, offer.id).then((detail) => detail.versions).catch(() => [] as OfferVersion[]))),
    Promise.all(strategies.data.map((strategy) => getMessagingStrategy(workspaceSlug, strategy.id).then((detail) => detail.versions ?? []).catch(() => [] as readonly MessagingStrategyVersion[]))),
    Promise.all(policies.data.map((policy) => getAIPolicy(workspaceSlug, policy.id).then((detail) => detail.versions ?? []).catch(() => [] as readonly AIPolicyVersion[]))),
    Promise.all(sequences.data.map((sequence) => listSequenceVersions(workspaceSlug, sequence.id).then((result) => result.data).catch(() => [] as SequenceVersion[]))),
  ]);
  return {
    icp: icps.data.map((version) => option(version, version.name)),
    offer: offerVersions.flat().map((version) => option(version, version.name)),
    strategy: strategyVersions.flat().map((version) => option(version, `${version.strategyId.slice(0, 8)}…`)),
    policy: policyVersions.flat().map((version) => option(version, `${version.policyId.slice(0, 8)}…`)),
    sequence: sequenceVersions.flat().map((version) => option(version, `${version.sequenceId.slice(0, 8)}…`)),
  };
}

function option(version: IcpVersion | OfferVersion | MessagingStrategyVersion | AIPolicyVersion | SequenceVersion, label: string): PublishedOption {
  return { id: version.id, version: version.version, label, publishedAt: version.publishedAt };
}

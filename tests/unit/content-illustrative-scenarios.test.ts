import { fixtureReadinessInput } from "../fixtures/content/audit-coverage";
import { expect, test } from "bun:test";
import { assertGroundedContentDraft, evaluateContentReadiness, editorialQualityCriteria } from "@outbound/domain/content/content-asset";

const scenario = 'Exemple fictif : le ticket porte sur la version 4.2 et le document décrit la version 4.1.';
const draft = { hook:'Vérifiez la version avant de répondre.', body:'Vérifiez la version avant de répondre.\n\n'+scenario, callToAction:null, factualClaims:[],opinionStatements:[],illustrativeScenarios:[scenario] };
const critique = {qualityAssessment:Object.fromEntries(editorialQualityCriteria.map(key=>[key,{verdict:'pass',reason:'Le texte illustre une vérification proposée, sans revendiquer de performance.',excerpts:[scenario]}])) as any,genericPhrases:[],repeatedConcepts:[],callToActionAligned:true,distinctFromHistory:true,issues:[],summary:'Méthode illustrée'};
function assess(reviewedScenarios: any[] = []) { return evaluateContentReadiness(fixtureReadinessInput({draft,audit:{reviewedClaims:[],ungroundedStatements:[],forbiddenTopicMatches:[],reviewedScenarios},critique,availableEvidenceKeys:[],recentBodies:[]})); }

test('declared illustrative version numbers are allowed into audit, but not ready without that audit', () => {
  expect(()=>assertGroundedContentDraft(draft,[])).not.toThrow();
  expect(assess().blockers).toContain('unaudited_scenario');
});
test('an independent audit must confirm the exact hypothetical example', () => {
  expect(assess([{statement:scenario,verdict:'hypothetical',reason:'Les versions sont des entrées fictives clairement annoncées, sans promesse de résultat.'}]).ready).toBe(true);
  expect(assess([{statement:scenario,verdict:'misleading',reason:'Ce passage implique une performance réelle sans preuve.'}]).blockers).toContain('misleading_scenario');
});
test('an invented ledger cannot hide real numbers outside the labelled example', () => {
  expect(()=>assertGroundedContentDraft({...draft,body:draft.body+'\nLe taux de résolution réel est de 4.2%.'},[])).toThrow('CONTENT_DRAFT_UNSOURCED_NUMBER');
  expect(()=>assertGroundedContentDraft({...draft,illustrativeScenarios:['Nos clients obtiennent 42% de gains.']},[])).toThrow('CONTENT_DRAFT_SCENARIO_INVALID');
  const claim='Nos clients obtiennent 42% de gains.';
  expect(()=>assertGroundedContentDraft({...draft,body:claim,illustrativeScenarios:[claim]},[])).toThrow('CONTENT_DRAFT_SCENARIO_INVALID');
});

test('a negative audit cannot be discarded because it paraphrases a declared scenario', () => {
  const result=assess([
    {statement:scenario,verdict:'hypothetical',reason:'Exemple annoncé comme fictif sans affirmation de résultat réel.'},
    {statement:'La version 4.2 est automatiquement validée.',verdict:'misleading',reason:'Cette formulation implique une capacité réelle non étayée.'},
  ]);
  expect(result.blockers).toContain('misleading_scenario');
  expect(result.blockers).toContain('scenario_audit_invalid');
  expect(result.ready).toBe(false);
});

test('provider output requires scenario arrays while historical snapshots remain readable', async () => {
  const { z } = await import('zod');
  const { contentDraftSnapshotSchema, contentEvidenceAuditSchema } = await import('@outbound/contracts/content');
  expect(z.toJSONSchema(contentDraftSnapshotSchema).required).toContain('illustrativeScenarios');
  expect(z.toJSONSchema(contentEvidenceAuditSchema).required).toContain('reviewedScenarios');
  expect(contentDraftSnapshotSchema.parse({...draft,illustrativeScenarios:undefined}).illustrativeScenarios).toEqual([]);
  expect(contentEvidenceAuditSchema.parse({reviewedClaims:[],ungroundedStatements:[],forbiddenTopicMatches:[]}).reviewedScenarios).toEqual([]);
});

test('locates an undeclared media occurrence without blaming the declared caption', () => {
  const mediaPlan = { format: 'linkedin_document' as const, visualTone: 'editorial' as const, title: 'Version', subtitle: null, altText: 'Version', scenes: [], slides: [{ title: 'Vérifier', body: 'Le document porte la version 4.2.' }] };
  let failure: unknown;
  try { assertGroundedContentDraft({ ...draft, mediaPlan }, []); } catch (error) { failure = error; }
  expect(failure).toMatchObject({ message: 'CONTENT_DRAFT_UNSOURCED_NUMBER', locations: [{ field: 'mediaPlan.slides[0].body', numbers: ['4.2'] }] });
});

test('numeric locations preserve cross-field scenarios, URLs and ordered slide markers', () => {
  const body = 'Exemple fictif : version 4.2';
  const title = 'à comparer avec 4.1.';
  const candidate = { ...draft, body, illustrativeScenarios: [body+'\n'+title], mediaPlan: {
    format: 'linkedin_document' as const, visualTone: 'editorial' as const, title, subtitle: null, altText: 'Version', scenes: [], slides: [
      { title: '1. Observer', body: 'Source : https://example.com/18' },
      { title: '2. Comparer', body: 'Résultat réel : 18 dossiers.', items: [{ label: 'Conclusion', text: 'Un gain réel de 19 points.' }] },
    ],
  } };
  let failure: unknown;
  try { assertGroundedContentDraft(candidate, []); } catch (error) { failure = error; }
  expect(failure).toMatchObject({ message: 'CONTENT_DRAFT_UNSOURCED_NUMBER', locations: [
    { field: 'mediaPlan.slides[1].body', numbers: ['18'] },
    { field: 'mediaPlan.slides[1].items[0].text', numbers: ['19'] },
  ] });
});


test('numeric locations use the same multiline unit tokens as the gate', () => {
  let failure: unknown;
  try { assertGroundedContentDraft({ ...draft, body: '42\nM contrats', illustrativeScenarios: [] }, []); } catch (error) { failure = error; }
  expect(failure).toMatchObject({ message: 'CONTENT_DRAFT_UNSOURCED_NUMBER', locations: [{ field: 'body', numbers: ['42m'] }] });
});

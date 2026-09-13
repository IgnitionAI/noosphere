import { fixtureReadinessInput } from "../fixtures/content/audit-coverage";
import { expect, test } from 'bun:test';
import { evaluateContentReadiness, type ContentEditorialCritique } from '@outbound/domain/content/content-asset';

const body = 'Pour tester votre procédure, prenez un ticket anonymisé. Notez la source utilisée et le point où une validation humaine devient nécessaire.';
const criteria = ['audienceRelevance', 'readerValue', 'coherence', 'sourceAttribution', 'ctaTruthfulness', 'brandVoice', 'distinctness'] as const;
function assessment() {
  return Object.fromEntries(criteria.map(key => [key, { verdict: 'pass', reason: 'Le texte propose un exercice explicite sans promettre de résultat mesuré.', excerpts: [body] } ]));
}
function evaluate(qualityAssessment?: unknown, publicBody = body) {
  return evaluateContentReadiness(fixtureReadinessInput({
    draft: { hook: 'Pour tester votre procédure', body: publicBody, callToAction: null, factualClaims: [], opinionStatements: [body] },
    audit: { reviewedClaims: [], ungroundedStatements: [], forbiddenTopicMatches: [] },
    critique: { genericPhrases: [], repeatedConcepts: [], callToActionAligned: true, distinctFromHistory: true, issues: [], summary: 'Prêt', ...(qualityAssessment ? { qualityAssessment } : {}) } as unknown as ContentEditorialCritique,
    availableEvidenceKeys: [], recentBodies: [],
  }));
}
test('a legacy positive summary is insufficient for editorial readiness', () => {
  expect(evaluate().blockers).toContain('editorial_assessment_missing');
});
test('useful short advice can pass without manufactured facts or a lead magnet', () => {
  expect(evaluate(assessment())).toEqual({ready:true, blockers:[]});
});
test('a failed reader-value criterion cannot be overridden by a positive summary', () => {
  expect(evaluate({...assessment(), readerValue:{verdict:'revise',reason:'Only restates a source; no useful reader takeaway.',excerpts:[body]}}).blockers).toContain('editorial_readerValue');
});
test('a pass citing text absent from the post is not a valid assessment', () => {
  expect(evaluate({...assessment(), readerValue:{verdict:'pass',reason:'Specific actionable steps are present.',excerpts:['An invented passage that does not occur in the post.']}}).blockers).toContain('editorial_assessment_invalid');
});
test('an omitted criterion fails closed', () => {
  const partial = assessment(); delete partial.ctaTruthfulness;
  expect(evaluate(partial).blockers).toContain('editorial_assessment_invalid');
});

test('the critic response schema uses explicit required fields accepted by structured-output providers', async () => {
  const { z } = await import('zod');
  const { currentContentEditorialCritiqueSchema } = await import('@outbound/contracts/content');
  const schema = z.toJSONSchema(currentContentEditorialCritiqueSchema);
  expect(JSON.stringify(schema)).not.toContain('propertyNames');
  const quality = schema.properties?.qualityAssessment as { required: string[] };
  expect(quality.required).toEqual([...criteria]);
});

test('structural list numbering and citation URLs are not factual numeric claims', async () => {
  const { assertGroundedContentDraft } = await import('@outbound/domain/content/content-asset');
  const draft = {hook:'Méthode proposée',body:'Méthode proposée :\n1. Relever le document consulté.\n2. Distinguer l’hypothèse.\n3. Définir la validation humaine.\nSource : https://example.com/reports/2026/07',callToAction:null,factualClaims:[],opinionStatements:[]};
  expect(() => assertGroundedContentDraft(draft,[])).not.toThrow();
  expect(() => assertGroundedContentDraft({...draft,body: draft.body+'\nCette méthode réduit les délais de 42%.'},[])).toThrow('CONTENT_DRAFT_UNSOURCED_NUMBER');
  expect(() => assertGroundedContentDraft({...draft,body:'En 2026, les délais diminuent.'},[])).toThrow('CONTENT_DRAFT_UNSOURCED_NUMBER');
});


test('numeric prose beside a URL or at the start of a sentence still requires evidence', async () => {
  const { assertGroundedContentDraft } = await import('@outbound/domain/content/content-asset');
  for (const body of ['42. C’est le nombre de clients accompagnés cette année.', 'Notre progression (https://example.com):42%.']) {
    expect(() => assertGroundedContentDraft({hook:'Résultats',body,callToAction:null,factualClaims:[],opinionStatements:[]},[])).toThrow('CONTENT_DRAFT_UNSOURCED_NUMBER');
  }
});

test('a repeated takeaway must block even when other editorial dimensions pass', () => {
  expect(evaluate({...assessment(), distinctness:{verdict:'revise',reason:'The same diagnostic and reader takeaway already appear in the preceding post.',excerpts:[body]}}).blockers).toContain('editorial_distinctness');
});

test('diagnostic list questions and quoted titles are not competing reader calls to action', () => {
  const copy = body + '\n1. La procédure couvre-t-elle cette version ?\n2. Le document est-il encore valide ?\nExercice proposé : « Quelle version ? ».\nQuel cas ajouteriez-vous ?';
  expect(evaluate(assessment(), copy).ready).toBe(true);
});

test('consecutive carousel heading numbers are structural, while numbers in their prose remain grounded', async () => {
  const { assertGroundedContentDraft } = await import('@outbound/domain/content/content-asset');
  const slides = [
    { title: 'Le contrôle proposé', body: 'Une méthode à adapter.' },
    { title: '1. Identifier', body: 'Retrouver le document.' },
    { title: '2. Vérifier', body: 'Lire le passage.' },
    { title: '3. Décider', body: 'Définir une validation.' },
  ];
  const candidate = { hook:'Une méthode à adapter.', body:'Une méthode à adapter.', callToAction:null, factualClaims:[], opinionStatements:[], mediaPlan:{format:'linkedin_document' as const,visualTone:'editorial' as const,title:'Méthode proposée',subtitle:null,altText:'Méthode',slides,scenes:[]} };
  expect(()=>assertGroundedContentDraft(candidate,[])).not.toThrow();
  expect(()=>assertGroundedContentDraft({...candidate,mediaPlan:{...candidate.mediaPlan,slides:[...slides,{title:'Résultat',body:'42% de gains.'}]}},[])).toThrow('CONTENT_DRAFT_UNSOURCED_NUMBER');
  expect(()=>assertGroundedContentDraft({...candidate,mediaPlan:{...candidate.mediaPlan,slides:[{title:'42. Clients servis',body:'Un résultat réel.'}]}},[])).toThrow('CONTENT_DRAFT_UNSOURCED_NUMBER');
});


test('multiline slide headings cannot shift numeric claims outside the checked text', async () => {
  const { assertGroundedContentDraft } = await import('@outbound/domain/content/content-asset');
  const candidate = {hook:'Méthode',body:'Une proposition.',callToAction:null,factualClaims:[],opinionStatements:[],mediaPlan:{format:'linkedin_document' as const,visualTone:'editorial' as const,title:'Méthode',subtitle:null,altText:'Méthode',slides:[{title:'Introduction\nMéthode',body:'Contexte.'},{title:'Vérification',body:'Procédure.'},{title:'42% de gains',body:'Résultat.'}],scenes:[]}};
  expect(()=>assertGroundedContentDraft(candidate,[])).toThrow('CONTENT_DRAFT_UNSOURCED_NUMBER');
});


test('URL query separators are not reader questions, including beside a genuine CTA', () => {
  const copy = body + '\nSources : https://example.com/a?hl=fr ; [Documentation](https://example.com/b?lang=fr&view=full)\nQuel cas ajouteriez-vous ?';
  expect(evaluate(assessment(), copy).ready).toBe(true);
  expect(evaluate(assessment(), copy + '\nQuelle méthode utilisez-vous ?').blockers).toContain('multiple_questions');
  expect(evaluate(assessment(), body + '\nUtilisez-vous [ce guide](https://example.com/guide)?\nConsultez-vous [cette page](https://example.com/page)?').blockers).toContain('multiple_questions');
});


test('an answered third-person decision question is not a second reader CTA', () => {
  const explanation = 'Le contexte supplémentaire permet-il de retrouver une connaissance utilisable ? Si oui, on réutilise la connaissance trouvée. Si aucune connaissance adaptée ne ressort, on analyse la solution avant de créer un article.';
  const copy = body + '\n' + explanation + '\nQuel cas ajouteriez-vous ?';
  expect(evaluate(assessment(), copy).ready).toBe(true);
  expect(evaluate(assessment(), copy + '\nQuelle méthode utilisez-vous ?').blockers).toContain('multiple_questions');
});

test.each([
  'Le contexte permet-il de retrouver une connaissance utilisable ?',
  'Le contexte permet-il de retrouver une connaissance utilisable ? Si oui, on réutilise.',
  'Un audit serait-il utile ? Si oui, réservez un créneau avec notre équipe. Sinon, demandez une démonstration.',
  'Un audit serait-il utile ? Si oui, il reste des créneaux : réservez dès maintenant. Sinon, une démonstration est disponible : contactez notre équipe.',
  'Souhaitez-vous un audit ? Si oui, réservez votre rendez-vous. Sinon, contactez notre équipe.',
  'Votre contexte permet-il de retrouver une connaissance ? Si oui, réservez un audit. Sinon, demandez une démonstration.',
])('keeps unanswered decisions and answered solicitations in the reader question count: %s', (question) => {
  expect(evaluate(assessment(), body + '\n' + question + '\nQuelle méthode utilisez-vous ?').blockers).toContain('multiple_questions');
});

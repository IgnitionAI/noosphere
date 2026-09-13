import {expect,test} from 'bun:test';
import {evaluateContentReadiness,editorialQualityCriteria} from '@outbound/domain/content/content-asset';
const body='Pour tester votre procédure, prenez un ticket anonymisé. Notez la source utilisée et le point où une validation humaine devient nécessaire.';
const input:Parameters<typeof evaluateContentReadiness>[0]={draft:{hook:'Pour tester votre procédure',body,callToAction:null,factualClaims:[],opinionStatements:[body]},audit:{reviewedClaims:[],ungroundedStatements:[],forbiddenTopicMatches:[]},critique:{qualityAssessment:Object.fromEntries(editorialQualityCriteria.map(k=>[k,{verdict:'pass',reason:'Le texte propose un exercice explicite sans promettre de résultat mesuré.',excerpts:[body]}])) as unknown as import('@outbound/domain/content/content-asset').ContentQualityAssessment,genericPhrases:[],repeatedConcepts:[],callToActionAligned:true,distinctFromHistory:true,issues:[],summary:'Prêt'},availableEvidenceKeys:[],recentBodies:[]};
test('useful advice remains ready with an unrelated vocabulary source',()=> {
expect(evaluateContentReadiness(input).ready).toBe(true);
expect(evaluateContentReadiness({...input,evidenceExcerpts:['Index alphabétique des termes : anonymisé, devient, humaine, nécessaire, notez, point, prenez, procédure, source, tester, ticket, utilisée, validation, votre.']}).blockers).not.toContain('source_paraphrase');
});
const mediaPlan:NonNullable<import('@outbound/domain/content/content-asset').ContentDraftSnapshot['mediaPlan']>={format:'linkedin_document',visualTone:'editorial',title:'Décider avec le contexte',subtitle:null,altText:'Méthode de validation',scenes:[],slides:[{layout:'cover',title:'Décider avec le contexte',body:'Une méthode de validation à appliquer au ticket.',items:[]},{layout:'comparison',title:'Choisir la prochaine action',body:'Comparer le contexte disponible avec celui qui manque.',items:[{label:'Contexte suffisant',text:'Documenter les éléments utilisés avant de valider.'},{label:'Contexte manquant',text:'Demander les éléments nécessaires avant de poursuivre.'}]},{layout:'closing',title:'Appliquer au prochain ticket',body:'Quelle information manque pour prendre cette décision ?',items:[]}]};
test('a focused three-page comparison can be publishable',()=>{
expect(evaluateContentReadiness({...input,draft:{...input.draft,mediaPlan}})).toEqual({ready:true,blockers:[]});
});

test('an entire short source copied verbatim remains blocked', () => {
  const copy = 'Documentez précisément toute validation humaine.';
  const result = evaluateContentReadiness({
    ...input,
    draft: {...input.draft, body: copy},
    evidenceExcerpts: [copy],
  });
  expect(result.blockers).toContain('source_paraphrase');
});

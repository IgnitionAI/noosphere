import { describe, expect, test } from "bun:test";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { DeterministicContentMediaRenderer } from "@outbound/infrastructure/content/deterministic-content-media-renderer";
import { DEFAULT_CONTENT_BRAND_KIT } from "@outbound/domain/content/content-brand-kit";

describe("DeterministicContentMediaRenderer", () => {
  test("identifies the overflowing cover kicker without blaming its body", async () => {
    const plan = { format: "linkedin_document" as const, visualTone: "editorial" as const, title: "Accès", subtitle: null, altText: "Accès", scenes: [], slides: [
      { layout: "cover" as const, title: "Authentifié ≠ autorisé", body: "L’identité ne prouve pas les droits.", kicker: "NOOSPHERE · ACCÈS GOUVERNÉ" },
      { layout: "insight" as const, title: "Vérifier les droits", body: "Comparer les documents autorisés." },
      { layout: "closing" as const, title: "Vérifier", body: "Conserver la portée du contrôle." },
    ] };
    const render = () => new DeterministicContentMediaRenderer().render({ format: "linkedin_document", plan, brandKit: DEFAULT_CONTENT_BRAND_KIT, body: "Texte", outputDirectory: `/tmp/noosphere-field-fit-${crypto.randomUUID()}` });
    await expect(render()).rejects.toMatchObject({ slideNumber: 1, layout: "cover", textConstraint: { field: "kicker", maxCharactersPerLine: 24, maxLines: 1, actualCharacters: 26 } });
    plan.slides[0]!.kicker = "ACCÈS GOUVERNÉ";
    expect((await render()).pageCount).toBe(3);
  });

  test("reports overflowing cover and closing pages together without returning a partial PDF", async () => {
    await expect(new DeterministicContentMediaRenderer().render({
      format: "linkedin_document", body: "Texte", brandKit: DEFAULT_CONTENT_BRAND_KIT,
      outputDirectory: `/tmp/noosphere-multiple-overflows-${crypto.randomUUID()}`,
      plan: { format: "linkedin_document", visualTone: "editorial", title: "Accès", subtitle: null, altText: "Accès", scenes: [], slides: [
        { layout: "cover", title: "Authentifié ≠ autorisé", body: "Examiner les droits.", kicker: "NOOSPHERE · ACCÈS GOUVERNÉ" },
        { layout: "insight", title: "Le contrôle", body: "Comparer les documents autorisés." },
        { layout: "closing", title: "Vérifier", body: "Métadonnée → filtre → exclusion avant génération. La source décrit Azure Logic Apps et Azure AI Search. Elle ne valide pas une autre solution ni la conformité complète d’un déploiement." },
      ] },
    })).rejects.toMatchObject({ message: "CONTENT_MEDIA_TEXT_OVERFLOW", errors: [
      { slideNumber: 1, layout: "cover", textConstraint: { field: "kicker", actualCharacters: 26 } },
      { slideNumber: 3, layout: "closing", textConstraint: { field: "body", maxCharactersPerLine: 34, maxLines: 5 } },
    ] });
  });

  test("reports both paragraph and callout overflow on the same closing page", async () => {
    const regular = { title: "Vérifier", body: "Comparer les droits." };
    await expect(new DeterministicContentMediaRenderer().render({
      format: "linkedin_document", body: "Texte", brandKit: DEFAULT_CONTENT_BRAND_KIT,
      outputDirectory: `/tmp/noosphere-page-fields-${crypto.randomUUID()}`,
      plan: { format: "linkedin_document", visualTone: "editorial", title: "Accès", subtitle: null, altText: "Accès", scenes: [],
        slides: [regular, regular, { ...regular,
          body: "Pour un pilote, validez séparément l’identité, les métadonnées de permissions et le filtrage effectif. Microsoft documente cette architecture pour Azure Logic Apps et Azure AI Search.",
          callout: "L’accès à l’assistant n’est pas la preuve de l’accès à chaque connaissance.",
        }],
      },
    })).rejects.toMatchObject({ message: "CONTENT_MEDIA_TEXT_OVERFLOW", errors: [
      { slideNumber: 3, layout: "closing", textConstraint: { field: "body", maxCharactersPerLine: 34, maxLines: 5 } },
      { slideNumber: 3, layout: "closing", textConstraint: { field: "callout", maxCharactersPerLine: 32, maxLines: 2 } },
    ] });
  });

  test.each(["cover", "closing", "insight", "checklist", "comparison", "framework", "process"] as const)("collects independent text constraints throughout a %s page", async layout => {
    const regular = { title: "Vérifier", body: "Comparer les droits." };
    const overflowing = { title: "Titre ".repeat(50), body: "Explication ".repeat(50), kicker: "Rubrique ".repeat(20), callout: "Conclusion ".repeat(40), layout };
    const slides = layout === "cover" ? [overflowing, regular, regular]
      : layout === "closing" ? [regular, regular, overflowing] : [regular, overflowing, regular];
    const failure = await new DeterministicContentMediaRenderer().render({
      format: "linkedin_document", body: "Texte", brandKit: DEFAULT_CONTENT_BRAND_KIT,
      outputDirectory: `/tmp/noosphere-all-field-errors-${crypto.randomUUID()}`,
      plan: { format: "linkedin_document", visualTone: "editorial", title: "Accès", subtitle: null, altText: "Accès", scenes: [], slides },
    }).then(() => { throw new Error("Overflowing document must not render"); }, error => error);
    expect(failure.message).toBe("CONTENT_MEDIA_TEXT_OVERFLOW");
    expect(failure.errors.map((error: { textConstraint?: { field: string } }) => error.textConstraint?.field)).toEqual(expect.arrayContaining(["title", "body", "kicker", "callout"]));
  });

  test.each(["checklist", "comparison", "framework", "process", "closing"] as const)("continues through overflowing labels and text in every %s item", async layout => {
    const regular = { title: "Vérifier", body: "Comparer les droits." };
    const overflowing = { ...regular, layout, items: Array.from({ length: 2 }, () => ({ label: "Rubrique ".repeat(30), text: "Explication ".repeat(40) })) };
    const slides = layout === "closing" ? [regular, regular, overflowing] : [regular, overflowing, regular];
    const failure = await new DeterministicContentMediaRenderer().render({
      format: "linkedin_document", body: "Texte", brandKit: DEFAULT_CONTENT_BRAND_KIT,
      outputDirectory: `/tmp/noosphere-item-field-errors-${crypto.randomUUID()}`,
      plan: { format: "linkedin_document", visualTone: "editorial", title: "Accès", subtitle: null, altText: "Accès", scenes: [], slides },
    }).then(() => { throw new Error("Overflowing items must not render"); }, error => error);
    expect(failure.message).toBe("CONTENT_MEDIA_TEXT_OVERFLOW");
    const fields = failure.errors.map((error: { textConstraint?: { field: string } }) => error.textConstraint?.field);
    expect(fields.filter((field: string) => field === "items[].label")).toHaveLength(2);
    expect(fields.filter((field: string) => field === "items[].text")).toHaveLength(2);
  });

  test.each(["checklist", "comparison"] as const)("fits a long explanation in %s and rejects excessive copy rather than clipping it", async (layout) => {
    const render = (text: string, count = 1) => new DeterministicContentMediaRenderer().render({
      format: "linkedin_document",
      plan: { format: "linkedin_document", visualTone: "editorial", title: "Choisir un contrôle", subtitle: null, altText: "Document", scenes: [],
        slides: [
          { layout: "cover", title: "Choisir un contrôle", body: "Comparer les observations." },
          { layout, title: "La règle de priorité", body: "Voici le point à vérifier.", callout: "Relier le constat à la décision.", items: Array.from({ length: count }, () => ({ label: "Priorité", text })) },
          { layout: "closing", title: "Un contrôle précis", body: "Conserver la conclusion complète." },
        ],
      },
      body: "Brouillon de test",
      brandKit: DEFAULT_CONTENT_BRAND_KIT,
      outputDirectory: `/tmp/noosphere-complete-copy-${crypto.randomUUID()}`,
    });
    const full = "La priorité est attribuée à l’aide d’une matrice définie qui prend en compte l’impact métier et l’urgence, et s’aligne directement sur les niveaux de SLA.";
    expect((await render(full)).pageCount).toBe(3);
    expect((await render(full, 2)).pageCount).toBe(3);
    for (const count of [3, 4]) expect((await render("Une explication concise.", count)).pageCount).toBe(3);
    await expect(render(full, 4)).rejects.toThrow("CONTENT_MEDIA_TEXT_OVERFLOW");
  });

  test.each(["process", "framework", "auto"] as const)("preserves every supplied field in a %s slide", async (layout) => {
    const middle = { layout, title: "Un contrôle précis", body: "Observer le point de départ.", kicker: "DÉCISION", callout: "Vérifier avant de conclure.", items: [{ label: "Observation", text: "Examiner le signal disponible." }] };
    const render = async (slide: typeof middle) => {
      const result = await new DeterministicContentMediaRenderer().render({ format: "linkedin_document",
        plan: { format: "linkedin_document", visualTone: "editorial", title: "Document", subtitle: null, altText: "Document", scenes: [],
          slides: [{ title: "Le point de départ", body: "Comparer les observations." }, slide, { title: "Une décision", body: "Vérifier le résultat." }],
        }, body: "Texte", brandKit: DEFAULT_CONTENT_BRAND_KIT, outputDirectory: `/tmp/noosphere-field-copy-${crypto.randomUUID()}` });
      const pdf = await PDFDocument.load(result.bytes);
      // Compare the page image stream, not PDF metadata or document timestamps.
      const resources = pdf.getPage(1).node.Resources()!;
      const { PDFDict, PDFName, PDFRawStream } = await import("pdf-lib");
      const images = resources.lookup(PDFName.of("XObject"), PDFDict);
      return images.entries().map(([, ref]) => {
        const stream = pdf.context.lookup(ref);
        if (!(stream instanceof PDFRawStream)) throw new Error("Expected page image stream");
        return new Bun.CryptoHasher("sha256").update(stream.contents).digest("hex");
      }).join(":");
    };
    const original = await render(middle);
    for (const field of ["body", "callout", "kicker"] as const) {
      expect(await render({ ...middle, [field]: "Une autre indication." })).not.toBe(original);
    }
    expect(await render({ ...middle, items: [{ ...middle.items[0]!, label: "Une autre observation" }] })).not.toBe(original);
    expect(await render({ ...middle, items: [{ ...middle.items[0]!, text: "Une autre explication complète." }] })).not.toBe(original);
    await expect(render({ ...middle, items: [{ ...middle.items[0]!, label: "ObservationSansEspace".repeat(4) }] })).rejects.toThrow("CONTENT_MEDIA_TEXT_OVERFLOW");
  });

  test("rejects closing overlap and unsupported cover items instead of hiding audited copy", async () => {
    const render = (slides: Array<{ title: string; body: string; callout?: string; items?: Array<{ label: string; text: string }> }>) => new DeterministicContentMediaRenderer().render({
      format: "linkedin_document", plan: { format: "linkedin_document", visualTone: "editorial", title: "Document", subtitle: null, altText: "Document", scenes: [], slides },
      body: "Texte", brandKit: DEFAULT_CONTENT_BRAND_KIT, outputDirectory: `/tmp/noosphere-overlap-${crypto.randomUUID()}`,
    });
    const regular = { title: "Une décision", body: "Une observation précise." };
    await expect(render([{ ...regular, items: [{ label: "Réserve", text: "Ne pas conclure sans preuve." }] }, regular, regular])).rejects.toMatchObject({message: "CONTENT_MEDIA_TEXT_OVERFLOW", slideNumber: 1, layout: "cover"});
    await expect(render([regular, regular, { title: "Observation test ".repeat(5).trim(), body: "Une observation claire et utile. ".repeat(5).trim(), callout: "Conserver cette réserve." }])).rejects.toThrow("CONTENT_MEDIA_TEXT_OVERFLOW");
  });

  test("renders a deterministic 4:5 PNG without an external generation provider", async () => {
    const renderer = new DeterministicContentMediaRenderer();
    const result = await renderer.render({
      format: "linkedin_image",
      plan: { format: "linkedin_image", visualTone: "editorial", title: "Une idée doit rester lisible", subtitle: "Le visuel soutient le post au lieu de le recopier.", altText: "Un schéma détaillé de trois contrôles qui ne sont pas dessinés", slides: [], scenes: [] },
      body: "Texte source",
      brandKit: DEFAULT_CONTENT_BRAND_KIT,
      outputDirectory: `/tmp/noosphere-image-test-${crypto.randomUUID()}`,
    });
    const metadata = await sharp(result.bytes).metadata();
    expect(result.mimeType).toBe("image/png");
    expect(metadata.width).toBe(1080);
    expect(metadata.height).toBe(1350);
    expect(result.altText).toContain("Une idée doit rester lisible");
    expect(result.altText).toContain("Le visuel soutient le post au lieu de le recopier.");
    expect(result.altText).not.toContain("trois contrôles");
  });

  test("alternative text describes the displayed copy rather than a clipped suffix", async () => {
    const result = await new DeterministicContentMediaRenderer().render({
      format: "linkedin_image",
      plan: { format: "linkedin_image", visualTone: "editorial", title: "Une décision", subtitle: "Un contenu volontairement long pour vérifier les limites du cadre et conserver uniquement les lignes effectivement affichées. ".repeat(4) + "SUFFIXE_ABSENT_DU_VISUEL", altText: "Un schéma imaginaire", slides: [], scenes: [] },
      body: "Texte",
      brandKit: DEFAULT_CONTENT_BRAND_KIT,
      outputDirectory: `/tmp/noosphere-image-alt-test-${crypto.randomUUID()}`,
    });
    expect(result.altText).toContain("Un contenu volontairement long");
    expect(result.altText).not.toContain("SUFFIXE_ABSENT_DU_VISUEL");
  });

  test("keeps generated alternative text within the persisted media limit for valid long brand fields", async () => {
    const result = await new DeterministicContentMediaRenderer().render({
      format: "linkedin_image",
      plan: { format: "linkedin_image", visualTone: "editorial", title: "méthode ".repeat(18).trim(), subtitle: "information ".repeat(22).trim(), altText: "Carte", slides: [], scenes: [] },
      body: "Texte",
      brandKit: { ...DEFAULT_CONTENT_BRAND_KIT, brandName: "Marque ".repeat(20).slice(0, 120).trim(), tagline: "Une signature longue ".repeat(10).slice(0, 180).trim() },
      outputDirectory: `/tmp/noosphere-image-alt-limit-${crypto.randomUUID()}`,
    });
    expect(result.altText!.length).toBeLessThanOrEqual(500);
    expect(result.altText).toContain("méthode");
    expect(result.altText).toContain("information");
  });

  test("keeps the four image art directions visually distinct", async () => {
    const renderer = new DeterministicContentMediaRenderer();
    const hashes = await Promise.all((["editorial", "technical", "bold", "minimal"] as const).map(async (imageStyle) => {
      const result = await renderer.render({
        format: "linkedin_image",
        plan: { format: "linkedin_image", visualTone: imageStyle, title: "Un signal devient une conversation", subtitle: "Chaque direction doit avoir une composition propre.", altText: "Carte Noosphere", slides: [], scenes: [] },
        body: "Texte source",
        brandKit: { ...DEFAULT_CONTENT_BRAND_KIT, imageStyle },
        outputDirectory: `/tmp/noosphere-image-style-test-${imageStyle}-${crypto.randomUUID()}`,
      });
      return new Bun.CryptoHasher("sha256").update(result.bytes).digest("hex");
    }));
    expect(new Set(hashes).size).toBe(4);
  });

  test("composites the imported logo into a branded image", async () => {
    const logoBytes = await sharp({ create: { width: 180, height: 80, channels: 4, background: "#E11D78" } }).png().toBuffer();
    const renderer = new DeterministicContentMediaRenderer();
    const plain = await renderer.render({
      format: "linkedin_image",
      plan: { format: "linkedin_image", visualTone: "editorial", title: "Une marque cohérente", subtitle: "Sur chaque contenu", altText: "Carte", slides: [], scenes: [] },
      body: "Texte source",
      brandKit: DEFAULT_CONTENT_BRAND_KIT,
      outputDirectory: `/tmp/noosphere-logo-plain-${crypto.randomUUID()}`,
    });
    const branded = await renderer.render({
      format: "linkedin_image",
      plan: { format: "linkedin_image", visualTone: "editorial", title: "Une marque cohérente", subtitle: "Sur chaque contenu", altText: "Carte", slides: [], scenes: [] },
      body: "Texte source",
      brandKit: DEFAULT_CONTENT_BRAND_KIT,
      logoBytes,
      outputDirectory: `/tmp/noosphere-logo-branded-${crypto.randomUUID()}`,
    });
    expect(new Bun.CryptoHasher("sha256").update(branded.bytes).digest("hex")).not.toBe(new Bun.CryptoHasher("sha256").update(plain.bytes).digest("hex"));
    expect(branded.manifest).toMatchObject({ logo: true });
  });

  test("renders a closing source credit without dropping it and rejects excess copy", async () => {
    const render = (text: string | null) => new DeterministicContentMediaRenderer().render({
      format: "linkedin_document", body: "Texte du post", brandKit: DEFAULT_CONTENT_BRAND_KIT,
      outputDirectory: `/tmp/noosphere-closing-credit-${crypto.randomUUID()}`,
      plan: { format: "linkedin_document", visualTone: "editorial", title: "Accès", subtitle: null, altText: "Document", scenes: [],
        slides: [
          { title: "Masquer n’est pas filtrer", body: "Le contrôle se vérifie dans la requête." },
          { layout: "insight", title: "Une distinction", body: "Comparer le champ et le résultat." },
          { layout: "closing", title: "Le point à retenir", kicker: "Azure AI Search",
            body: "`retrievable=false` n’est pas un mécanisme d’obfuscation du contenu ni de sécurité au niveau du champ.",
            callout: "Le filtre gouverne les résultats.",
            items: text === null ? [] : [{ label: "Source", text }],
          },
        ],
      },
    });
    const source = "Security filters for trimming results in Azure AI Search — Microsoft Learn";
    const result = await render(source);
    expect(result.pageCount).toBe(3);
    const imageBytes = async (bytes: Uint8Array) => {
      const { PDFDict, PDFName, PDFRawStream } = await import("pdf-lib");
      const pdf = await PDFDocument.load(bytes);
      const images = pdf.getPage(2).node.Resources()!.lookup(PDFName.of("XObject"), PDFDict);
      return images.entries().map(([, ref]) => pdf.context.lookup(ref)).flatMap(x => x instanceof PDFRawStream ? [new Bun.CryptoHasher("sha256").update(x.getContents()).digest("hex")] : []);
    };
    expect(await imageBytes(result.bytes)).not.toEqual(await imageBytes((await render(null)).bytes));
    await expect(render(source.repeat(20))).rejects.toMatchObject({ message: "CONTENT_MEDIA_TEXT_OVERFLOW", slideNumber: 3, layout: "closing" });
  });

  test("renders comparison differently from checklist for identical options", async () => {
    const render = async (layout: "comparison" | "checklist") => {
      const result = await new DeterministicContentMediaRenderer().render({
        format: "linkedin_document", body: "Comparer", brandKit: DEFAULT_CONTENT_BRAND_KIT,
        outputDirectory: `/tmp/noosphere-comparison-columns-${crypto.randomUUID()}`,
        plan: { format: "linkedin_document", visualTone: "editorial", title: "Comparer", subtitle: null, altText: "Options", scenes: [], slides: [
          { title: "Comparer", body: "Deux options." },
          { layout, title: "Les options", body: "Choisir selon le contexte.", items: [{ label: "Première option", text: "Observer les résultats disponibles." }, { label: "Seconde option", text: "Vérifier les conditions applicables." }] },
          { title: "Décider", body: "Garder le contexte." },
        ] },
      });
      const { PDFDict, PDFName, PDFRawStream } = await import("pdf-lib");
      const pdf = await PDFDocument.load(result.bytes);
      const images = pdf.getPage(1).node.Resources()!.lookup(PDFName.of("XObject"), PDFDict);
      return images.entries().map(([, ref]) => pdf.context.lookup(ref)).flatMap(x => x instanceof PDFRawStream ? [new Bun.CryptoHasher("sha256").update(x.getContents()).digest("hex")] : []);
    };
    expect(await render("comparison")).not.toEqual(await render("checklist"));
  });

  test("renders a LinkedIn carousel as a multi-page PDF document", async () => {
    const renderer = new DeterministicContentMediaRenderer();
    const result = await renderer.render({
      format: "linkedin_document",
      plan: {
        format: "linkedin_document",
        visualTone: "technical",
        title: "Cinq décisions",
        subtitle: null,
        altText: "Carrousel Noosphere en cinq pages",
        slides: [
          { layout: "cover", kicker: "Guide", title: "Le signal ne suffit pas", body: "Il faut relier chaque observation à une décision.", callout: null, items: [] },
          { layout: "insight", kicker: "Constat", title: "Partir du problème", body: "Observer avant de proposer.", callout: "Un signal sans contexte reste du bruit.", items: [] },
          { layout: "comparison", kicker: "Arbitrage", title: "Deux façons d'agir", body: "Comparer les options.", callout: null, items: [{ label: "Sans preuve", text: "Décider au ressenti." }, { label: "Avec preuve", text: "Décider avec le contexte." }] },
          { layout: "process", kicker: "Méthode", title: "Passer à l'action", body: "Trois étapes simples.", callout: null, items: [{ label: "Observer", text: "Collecter le signal." }, { label: "Vérifier", text: "Résoudre la source." }, { label: "Agir", text: "Décider avec contexte." }] },
          { layout: "closing", kicker: null, title: "La décision devient traçable", body: "Le contexte reste attaché à l'action.", callout: "Quelle décision voulez-vous mieux documenter ?", items: [] },
        ],
        scenes: [],
      },
      body: "Texte source",
      brandKit: DEFAULT_CONTENT_BRAND_KIT,
      outputDirectory: `/tmp/noosphere-document-test-${crypto.randomUUID()}`,
    });
    const document = await PDFDocument.load(result.bytes);
    expect(result.mimeType).toBe("application/pdf");
    expect(document.getPageCount()).toBe(5);
    expect(result.pageCount).toBe(5);
    expect(result.manifest).toEqual(expect.objectContaining({ renderer: "pdf-lib-sharp-v9", narrativeLayouts: ["cover", "insight", "comparison", "process", "closing"] }));
  });

  const ffmpeg = Bun.which("ffmpeg");
  (ffmpeg ? test : test.skip)("renders a native H.264 motion video when FFmpeg is installed", async () => {
    const renderer = new DeterministicContentMediaRenderer(ffmpeg!);
    const result = await renderer.render({
      format: "linkedin_video",
      plan: { format: "linkedin_video", visualTone: "bold", title: "Une preuve, trois décisions", subtitle: null, altText: "Vidéo Noosphere en trois scènes", slides: [], scenes: [{ title: "Observer", body: "Partir du signal réel.", durationSeconds: 4 }, { title: "Vérifier", body: "Relier chaque fait à sa preuve.", durationSeconds: 4 }, { title: "Agir", body: "Publier avec un contexte durable.", durationSeconds: 4 }] },
      body: "Texte source",
      brandKit: DEFAULT_CONTENT_BRAND_KIT,
      outputDirectory: `/tmp/noosphere-video-test-${crypto.randomUUID()}`,
    });
    expect(result.mimeType).toBe("video/mp4");
    expect(result.durationSeconds).toBe(12);
    expect(new TextDecoder().decode(result.bytes.slice(4, 8))).toBe("ftyp");
    expect(result.bytes.byteLength).toBeGreaterThan(10_000);
  }, 30_000);
});

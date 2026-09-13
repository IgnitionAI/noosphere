/** Skill documents are imported with Bun's explicit text loader. */
declare module "*.md" {
  const text: string;
  export default text;
}

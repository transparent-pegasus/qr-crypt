import { readdirSync, readFileSync } from "node:fs"
import { extname, join, relative, resolve } from "node:path"
import ts from "typescript"
import { describe, expect, it } from "vitest"

const SOURCE_ROOT = resolve(process.cwd(), "src")
const CATALOG_FILE = resolve(SOURCE_ROOT, "i18n/messages.ts")
const JAPANESE_TEXT = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return [".ts", ".tsx"].includes(extname(entry.name)) ? [path] : []
  })
}

function japaneseLiterals(file: string): string[] {
  const source = readFileSync(file, "utf8")
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const findings: string[] = []

  const record = (node: ts.Node, text: string) => {
    if (!JAPANESE_TEXT.test(text)) return
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(
      node.getStart(sourceFile),
    )
    findings.push(
      `${relative(process.cwd(), file)}:${line + 1}:${character + 1}: ${JSON.stringify(text)}`,
    )
  }

  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      record(node, node.text)
    } else if (ts.isTemplateExpression(node)) {
      record(node.head, node.head.text)
      for (const span of node.templateSpans) record(span.literal, span.literal.text)
    } else if (ts.isJsxText(node)) {
      record(node, node.getText(sourceFile))
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return findings
}

describe("production localization source guard", () => {
  it("keeps Japanese user-facing literals inside the catalog", () => {
    const findings = sourceFiles(SOURCE_ROOT)
      .filter((file) => file !== CATALOG_FILE)
      .flatMap(japaneseLiterals)

    expect(findings, findings.join("\n")).toEqual([])
  })
})

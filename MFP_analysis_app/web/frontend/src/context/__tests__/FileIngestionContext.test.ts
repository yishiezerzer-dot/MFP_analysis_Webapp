import { describe, it, expect } from "vitest";
import { classifyFile, ROUTING_RULES } from "../FileIngestionContext";

describe("FileIngestionContext", () => {
  it("classifies mzML files to LC-MS", () => {
    const file1 = new File(["dummy"], "sample_run.mzML");
    const file2 = new File(["dummy"], "sample_run.mzxml");
    const file3 = new File(["dummy"], "sample_run.mzml.gz");

    expect(classifyFile(file1)).toBe("/lcms");
    expect(classifyFile(file2)).toBe("/lcms");
    expect(classifyFile(file3)).toBe("/lcms");
  });

  it("classifies FTIR vendor files to FTIR", () => {
    const file1 = new File(["dummy"], "spectrum.dx");
    const file2 = new File(["dummy"], "spectrum.jdx");
    const file3 = new File(["dummy"], "spectrum.spa");
    const file4 = new File(["dummy"], "spectrum.spc");

    expect(classifyFile(file1)).toBe("/ftir");
    expect(classifyFile(file2)).toBe("/ftir");
    expect(classifyFile(file3)).toBe("/ftir");
    expect(classifyFile(file4)).toBe("/ftir");
  });

  it("classifies Excel spreadsheets to Plate Reader", () => {
    const file1 = new File(["dummy"], "assay_96well.xlsx");
    const file2 = new File(["dummy"], "plate_results.xls");

    expect(classifyFile(file1)).toBe("/plate-reader");
    expect(classifyFile(file2)).toBe("/plate-reader");
  });

  it("classifies JSON and Parquet to Data Studio", () => {
    const file1 = new File(["dummy"], "dataset.json");
    const file2 = new File(["dummy"], "table.parquet");

    expect(classifyFile(file1)).toBe("/data-studio");
    expect(classifyFile(file2)).toBe("/data-studio");
  });

  it("handles contextual classification for CSV files", () => {
    const csvFile = new File(["dummy"], "data.csv");

    // Defaults to /ftir when out of context
    expect(classifyFile(csvFile)).toBe("/ftir");
    // Respects current route if in Data Studio
    expect(classifyFile(csvFile, "/data-studio")).toBe("/data-studio");
    // Respects current route if in FTIR
    expect(classifyFile(csvFile, "/ftir")).toBe("/ftir");
  });

  it("exposes proper routing rule metadata for all supported instruments", () => {
    expect(ROUTING_RULES["/lcms"].badge).toBe("LCMS");
    expect(ROUTING_RULES["/ftir"].badge).toBe("FTIR");
    expect(ROUTING_RULES["/plate-reader"].badge).toBe("Plate");
    expect(ROUTING_RULES["/data-studio"].badge).toBe("Studio");
  });
});

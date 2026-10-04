"""Builds the bundled example files ("Try with example data"). Run once; the output is committed.

    python -m app.examples.make_examples      (from web/backend)

The LCMS and FTIR examples are synthetic but chemically sensible: a PLGA-type polyester of glycolic
acid (GA) and lactic acid (LA). The Plate Reader examples are two real BioTek Gen5 plates.
"""
from __future__ import annotations

import base64
import math
import shutil
import zlib
from pathlib import Path

import numpy as np

HERE = Path(__file__).parent
DATA = HERE / "data"
FIXTURES = HERE.parent.parent / "tests" / "fixtures" / "plate_reader"

GA, LA = 76.016044, 90.031694      # monoisotopic masses of the hydroxy acids
WATER, PROTON, SODIUM = 18.010565, 1.007276, 22.989218
C13 = 1.003355
UV_LEAD_MIN = 0.12                  # the UV detector sits before the MS


def oligomers():
    """(label, neutral mass, carbons, retention time, relative abundance) of linear GA/LA oligomers."""
    out = []
    for dp in range(2, 9):
        for n_la in range(0, dp + 1):
            n_ga = dp - n_la
            mass = n_ga * GA + n_la * LA - (dp - 1) * WATER
            carbons = 2 * n_ga + 3 * n_la
            rt = 1.2 + 1.35 * dp + 0.28 * n_la
            # Roughly 50:50 copolymer: middle compositions most common, abundance falls with length.
            abundance = math.comb(dp, n_la) / 2 ** dp * np.exp(-0.32 * (dp - 2))
            out.append((f"{n_ga}-GA + {n_la}-LA", mass, carbons, rt, abundance))
    return out


def _encode(a: np.ndarray) -> str:
    return base64.b64encode(zlib.compress(a.astype(np.float64).tobytes())).decode()


def make_mzml(path: Path, rng: np.random.Generator) -> list:
    series = oligomers()
    times = np.round(np.arange(0.0, 14.0, 0.05), 3)
    spectra = []
    for i, t in enumerate(times):
        mz, inten = [], []
        for _, mass, carbons, rt, ab in series:
            elution = np.exp(-0.5 * ((t - rt) / 0.09) ** 2)
            if elution < 1e-3:
                continue
            for ion_mass, factor in ((mass + PROTON, 1.0), (mass + SODIUM, 0.35)):
                base = 2.0e6 * ab * factor * elution
                p1 = carbons * 0.0107
                for k, rel in enumerate((1.0, p1, p1 * p1 / 2)):
                    mz.append(ion_mass + k * C13 + rng.normal(0, 0.0008))
                    inten.append(base * rel * rng.uniform(0.95, 1.05))
        # Plasticiser background (DEHP [M+H]+) in every scan, and chemical noise.
        mz.append(391.2843 + rng.normal(0, 0.0008))
        inten.append(4.0e5 * rng.uniform(0.9, 1.1))
        noise_n = 45
        mz.extend(rng.uniform(100, 1000, noise_n))
        inten.extend(rng.exponential(6.0e3, noise_n))
        order = np.argsort(mz)
        mz_a = np.asarray(mz)[order]
        in_a = np.asarray(inten)[order]
        spectra.append(f"""
      <spectrum id="scan={i + 1}" index="{i}" defaultArrayLength="{len(mz_a)}">
        <cvParam cvRef="MS" accession="MS:1000579" name="MS1 spectrum" value=""/>
        <cvParam cvRef="MS" accession="MS:1000511" name="ms level" value="1"/>
        <cvParam cvRef="MS" accession="MS:1000130" name="positive scan" value=""/>
        <cvParam cvRef="MS" accession="MS:1000285" name="total ion current" value="{float(in_a.sum()):.1f}"/>
        <scanList count="1"><scan>
          <cvParam cvRef="MS" accession="MS:1000016" name="scan start time" value="{t}" unitCvRef="UO" unitAccession="UO:0000031" unitName="minute"/>
        </scan></scanList>
        <binaryDataArrayList count="2">
          <binaryDataArray encodedLength="0"><cvParam cvRef="MS" accession="MS:1000574" name="zlib compression" value=""/>
            <cvParam cvRef="MS" accession="MS:1000523" name="64-bit float" value=""/>
            <cvParam cvRef="MS" accession="MS:1000514" name="m/z array" value=""/><binary>{_encode(mz_a)}</binary></binaryDataArray>
          <binaryDataArray encodedLength="0"><cvParam cvRef="MS" accession="MS:1000574" name="zlib compression" value=""/>
            <cvParam cvRef="MS" accession="MS:1000523" name="64-bit float" value=""/>
            <cvParam cvRef="MS" accession="MS:1000515" name="intensity array" value=""/><binary>{_encode(in_a)}</binary></binaryDataArray>
        </binaryDataArrayList>
      </spectrum>""")
    path.write_text(f"""<?xml version="1.0" encoding="utf-8"?>
<mzML xmlns="http://psi.hupo.org/ms/mzml" version="1.1.0">
  <cvList count="2">
    <cv id="MS" fullName="Proteomics Standards Initiative Mass Spectrometry Ontology" URI="https://raw.githubusercontent.com/HUPO-PSI/psi-ms-CV/master/psi-ms.obo"/>
    <cv id="UO" fullName="Unit Ontology" URI="http://ontologies.berkeleybop.org/uo.obo"/>
  </cvList>
  <run id="example_plga"><spectrumList count="{len(times)}">{''.join(spectra)}
  </spectrumList></run>
</mzML>
""", encoding="utf-8")
    return series


def make_uv(path: Path, series: list, rng: np.random.Generator) -> None:
    t = np.round(np.arange(0.0, 14.0, 0.01), 3)
    signal = 1.5 + 0.08 * t + rng.normal(0, 0.15, t.size)
    for _, _, _, rt, ab in series:
        signal += 220 * ab * np.exp(-0.5 * ((t - (rt - UV_LEAD_MIN)) / 0.08) ** 2)
    lines = ["Time (min),Absorbance 210 nm (mAU)"] + [f"{a:.3f},{b:.4f}" for a, b in zip(t, signal)]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def make_ftir(path: Path, rng: np.random.Generator) -> None:
    bands = [  # (centre cm-1, absorbance, half-width): PLGA film
        (3510, 0.06, 110), (2995, 0.10, 9), (2950, 0.13, 11), (1755, 1.00, 13), (1453, 0.22, 9),
        (1423, 0.12, 7), (1385, 0.18, 7), (1275, 0.30, 14), (1185, 0.72, 17), (1130, 0.45, 12),
        (1090, 0.80, 14), (1045, 0.25, 9), (870, 0.10, 8), (750, 0.08, 9),
    ]
    wn = np.arange(4000.0, 399.0, -2.0)
    y = 0.03 + 0.00002 * (4000 - wn)
    for c, a, w in bands:
        y += a * np.exp(-0.5 * ((wn - c) / w) ** 2)
    y += rng.normal(0, 0.002, wn.size)
    lines = ["Wavenumber (cm-1),Absorbance"] + [f"{a:.1f},{b:.5f}" for a, b in zip(wn, y)]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    DATA.mkdir(exist_ok=True)
    rng = np.random.default_rng(20261004)
    series = make_mzml(DATA / "example_plga.mzML", rng)
    make_uv(DATA / "example_plga_uv.csv", series, rng)
    make_ftir(DATA / "example_plga_film.csv", rng)
    for name, out in (("gen5_lacglydoh_511_111.xlsx", "example_mic_polymers.xlsx"),
                      ("gen5_gentamicin.xlsx", "example_mic_gentamicin.xlsx")):
        shutil.copyfile(FIXTURES / name, DATA / out)
    for p in sorted(DATA.iterdir()):
        print(f"{p.name}: {p.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()

import { describe, expect, it } from 'vitest';
import { parse } from './parse';

// Builds MDX files by hand, as the game writes version 1800: its cameras, lights and skins differ from version 800.

type Part = number[] | Uint8Array;

function int32 (...values: number[]): Uint8Array {
    const bytes = new Uint8Array(values.length * 4);
    const view = new DataView(bytes.buffer);
    values.forEach((value, index) => view.setInt32(index * 4, value, true));
    return bytes;
}

function float32 (...values: number[]): Uint8Array {
    const bytes = new Uint8Array(values.length * 4);
    const view = new DataView(bytes.buffer);
    values.forEach((value, index) => view.setFloat32(index * 4, value, true));
    return bytes;
}

function uint16 (...values: number[]): Uint8Array {
    const bytes = new Uint8Array(values.length * 2);
    const view = new DataView(bytes.buffer);
    values.forEach((value, index) => view.setUint16(index * 2, value, true));
    return bytes;
}

function text (value: string, length = 0): Uint8Array {
    const bytes = new Uint8Array(Math.max(length, value.length));
    for (let i = 0; i < value.length; ++i) {
        bytes[i] = value.charCodeAt(i);
    }
    return bytes;
}

function join (...parts: Part[]): Uint8Array {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const bytes = new Uint8Array(total);
    let at = 0;
    for (const part of parts) {
        bytes.set(part, at);
        at += part.length;
    }
    return bytes;
}

function chunk (tag: string, ...parts: Part[]): Uint8Array {
    const data = join(...parts);
    return join(text(tag), int32(data.length), data);
}

function model (version: number, ...chunks: Uint8Array[]): ArrayBuffer {
    return join(text('MDLX'), chunk('VERS', int32(version)), ...chunks).buffer as ArrayBuffer;
}

// A track of one key at frame 0, not interpolated, with no global sequence.
function track (tag: string, ...values: number[]): Uint8Array {
    return join(text(tag), int32(1, 0, -1, 0), float32(...values));
}

describe('a version 1800 camera', () => {
    it('is read though its size has 3 in its fourth byte', () => {
        const fixed = join(
            text('Portrait_Camera', 80),
            float32(40, -1, 88),
            float32(0.95, 10000, 0.1),
            float32(0, 0, 80)
        );
        const translation = track('KCTR', 1, 2, 3);
        const size = 4 + fixed.length + translation.length;
        const parsed = parse(model(1800, chunk('CAMS', int32(size | 0x3000000), fixed, translation)));

        expect(parsed.Cameras).toHaveLength(1);
        expect(parsed.Cameras[0].Name).toBe('Portrait_Camera');
        expect(parsed.Cameras[0].FieldOfView).toBeCloseTo(0.95);
        expect(Array.from(parsed.Cameras[0].Translation.Keys[0].Vector)).toEqual([1, 2, 3]);
    });
});

describe('a light', () => {
    const node = join(int32(96), text('Sun', 80), int32(0, -1, 0x200));
    const visibility = track('KLAV', 1);

    it('of version 1800 is read with its number before the attenuation and six after the ambient intensity', () => {
        const statics = join(
            int32(1, 0),
            float32(80, 200),
            float32(1, 0.5, 0.25, 1.3),
            float32(0.2, 0.3, 0.4, 0.4),
            float32(0.265, 0, 0, 0.001, 0, 0)
        );
        const size = 4 + node.length + statics.length + visibility.length;
        const parsed = parse(model(1800, chunk('LITE', int32(size), node, statics, visibility)));

        expect(parsed.Lights).toHaveLength(1);
        const light = parsed.Lights[0];
        expect(light.Name).toBe('Sun');
        expect(light.LightType).toBe(1);
        expect(light.AttenuationStart).toBe(80);
        expect(light.AttenuationEnd).toBe(200);
        expect(Array.from(light.Color as Float32Array)).toEqual([1, 0.5, 0.25]);
        expect(light.Intensity).toBeCloseTo(1.3);
        expect(light.AmbIntensity).toBeCloseTo(0.4);
        expect(light.Visibility.Keys[0].Vector[0]).toBe(1);
    });

    it('of version 800 is read as before', () => {
        const statics = join(int32(1), float32(80, 200), float32(1, 0.5, 0.25, 1.3), float32(0.2, 0.3, 0.4, 0.4));
        const size = 4 + node.length + statics.length + visibility.length;
        const parsed = parse(model(800, chunk('LITE', int32(size), node, statics, visibility)));

        expect(parsed.Lights[0].AttenuationEnd).toBe(200);
        expect(parsed.Lights[0].AmbIntensity).toBeCloseTo(0.4);
        expect(parsed.Lights[0].Visibility.Keys[0].Vector[0]).toBe(1);
    });
});

// A geoset of one triangle on one vertex, with a skin of the bytes given, as version 900 and later lay it out.
function geoset (skin: Uint8Array): Uint8Array {
    const data = join(
        text('VRTX'), int32(1), float32(0, 0, 0),
        text('NRMS'), int32(1), float32(0, 0, 1),
        text('PTYP'), int32(1, 4),
        text('PCNT'), int32(1, 3),
        text('PVTX'), int32(3), uint16(0, 0, 0),
        text('GNDX'), int32(1), [0],
        text('MTGC'), int32(1, 1),
        text('MATS'), int32(1, 0),
        int32(0, 0, 0),
        int32(0), text('', 80),
        float32(1, 0, 0, 0, 1, 1, 1),
        int32(0),
        text('SKIN'), int32(8), skin,
        text('UVAS'), int32(1),
        text('UVBS'), int32(1), float32(0.5, 0.5)
    );
    return join(int32(4 + data.length), data);
}

describe('a skin', () => {
    it('of version 1800 is read as two bytes an entry', () => {
        const parsed = parse(model(1800, chunk('GEOS', geoset(uint16(3, 7, 0, 0, 200, 55, 0, 0)))));

        expect(Array.from(parsed.Geosets[0].SkinWeights)).toEqual([3, 7, 0, 0, 200, 55, 0, 0]);
        expect(Array.from(parsed.Geosets[0].TVertices[0])).toEqual([0.5, 0.5]);
    });

    it('of a byte an entry is read as before', () => {
        const parsed = parse(model(900, chunk('GEOS', geoset(new Uint8Array([3, 7, 0, 0, 200, 55, 0, 0])))));

        expect(Array.from(parsed.Geosets[0].SkinWeights)).toEqual([3, 7, 0, 0, 200, 55, 0, 0]);
        expect(Array.from(parsed.Geosets[0].TVertices[0])).toEqual([0.5, 0.5]);
    });
});

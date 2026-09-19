import { phonemize } from "phonemizer";
import { describe, expect, it } from "vitest";
import { MAX_TOKENS, styleForLength, STYLE_DIM, textToPhonemes, tokenize } from "@/lib/voice/kokoro-text";

// Reference output from the official kokoro-js pipeline (its phonemizer + the model tokenizer).
// prettier-ignore
const REFERENCE: { text: string; phonemes: string; ids: number[] }[] = [{"text":"Hi, I'm Alex, and I'll be your interviewer today.","phonemes":"hˈaɪ, aɪm ˈælɪks, ænd aɪl biː jʊɹ ˈɪntɚvjˌuːɚ tədˈeɪ.","ids":[0,50,156,43,102,3,16,43,102,55,16,156,72,54,102,53,61,3,16,72,56,46,16,43,102,54,16,44,51,158,16,52,135,123,16,156,102,56,62,85,64,52,157,63,158,85,16,62,83,46,156,47,102,4,0]},{"text":"In 2019 the team saved $1,250.50 — about 30% of the budget.","phonemes":"ɪn twˈɛnti nˈaɪntiːn ðə tˈiːm sˈeɪvd wˈʌn θˈaʊzənd tˈuː hˈʌndɹɪd fˈɪfti dˈɑːlɚz ænd fˈɪfti sˈɛnts — ɐbˌaʊt θˈɜːɾi pɚsˈɛnt ʌvðə bˈʌdʒɪt.","ids":[0,102,56,16,62,65,156,86,56,62,51,16,56,156,43,102,56,62,51,158,56,16,81,83,16,62,156,51,158,55,16,61,156,47,102,64,46,16,65,156,138,56,16,119,156,43,135,68,83,56,46,16,62,156,63,158,16,50,156,138,56,46,123,102,46,16,48,156,102,48,62,51,16,46,156,69,158,54,85,68,16,72,56,46,16,48,156,102,48,62,51,16,61,156,86,56,62,61,16,9,16,70,44,157,43,135,62,16,119,156,87,158,125,51,16,58,85,61,156,86,56,62,16,138,64,81,83,16,44,156,138,46,147,102,62,4,0]},{"text":"Walk me through it: what's the time complexity, O(n) or O(n log n)?","phonemes":"wˈɔːk mˌiː θɹˈuː ɪt: wˌʌts ðə tˈaɪm kəmplˈɛksᵻɾi, ˈoʊ«ˈɛn» ɔːɹ ˈoʊ«ˈɛn lˈɔɡ ˈɛn»?","ids":[0,65,156,76,158,53,16,55,157,51,158,16,119,123,156,63,158,16,102,62,2,16,65,157,138,62,61,16,81,83,16,62,156,43,102,55,16,53,83,55,58,54,156,86,53,61,177,125,51,3,16,156,57,135,156,86,56,16,76,158,123,16,156,57,135,156,86,56,16,54,156,76,92,16,156,86,56,6,0]},{"text":"Yeah, that makes sense. Dr. Smith said the meeting is at 3:05.","phonemes":"jˈɛə, ðæt mˌeɪks sˈɛns. dˈɑːktɚ smˈɪθ sˈɛd ðə mˈiːɾɪŋ ɪz æt θɹˈiː ˈoʊ fˈaɪv.","ids":[0,52,156,86,83,3,16,81,72,62,16,55,157,47,102,53,61,16,61,156,86,56,61,4,16,46,156,69,158,53,62,85,16,61,55,156,102,119,16,61,156,86,46,16,81,83,16,55,156,51,158,125,102,112,16,102,68,16,72,62,16,119,123,156,51,158,16,156,57,135,16,48,156,43,102,64,4,0]}];

describe("Kokoro text pipeline", () => {
  it.each(REFERENCE)("matches kokoro-js for: $text", async ({ text, phonemes, ids }) => {
    const mine = await textToPhonemes(text, phonemize);
    expect(mine).toBe(phonemes);
    expect(tokenize(mine)).toEqual(ids);
  });

  it("caps long input to the model context", () => {
    const ids = tokenize("a".repeat(2000));
    expect(ids.length).toBe(MAX_TOKENS + 2);
    expect(ids[0]).toBe(0);
    expect(ids.at(-1)).toBe(0);
  });

  it("selects the style vector for the utterance length", () => {
    const voice = Float32Array.from({ length: 510 * STYLE_DIM }, (_, i) => Math.floor(i / STYLE_DIM));
    expect(styleForLength(voice, 12)[0]).toBe(10);
    expect(styleForLength(voice, 1)[0]).toBe(0);
    expect(styleForLength(voice, 5000)[0]).toBe(509);
    expect(styleForLength(voice, 12)).toHaveLength(STYLE_DIM);
  });
});

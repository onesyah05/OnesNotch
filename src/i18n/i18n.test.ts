import en from "./en.json";
import id from "./id.json";

function keys(obj: object, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === "object" && v !== null ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe("i18n", () => {
  it("id and en define the same keys", () => {
    expect(keys(id).sort()).toEqual(keys(en).sort());
  });
});

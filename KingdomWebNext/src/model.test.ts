import { expect, it } from "vitest";
import { editIdentity, filterEntities, newBuilding, canEdit } from "./model";

it("edits identity without dropping historical rules, relations or extensions", () => {
  const original = {
    name: "Atelier",
    actions: [{ key: "work", effects: [{ type: "future" }] }],
    modules: { unknown: { value: 42 } },
    future: true,
  };
  const edited = editIdentity(original, {
    name: "Manufacture",
    description: "Un lieu",
  });
  expect(edited).toEqual({
    ...original,
    name: "Manufacture",
    description: "Un lieu",
  });
  expect(original.name).toBe("Atelier");
});
it("starts with an empty generic building rather than content from a template", () => {
  expect(newBuilding()).toEqual({
    name: "",
    description: "",
    emoji: "◇",
    entity_kind: "place",
    actions: [],
    modules: {},
  });
});
it("filters by name or category using French accent insensitive search", () => {
  const rows = [
    {
      entity_type: "building",
      entity_key: "cafe",
      version: 1,
      status: "draft" as const,
      payload: { name: "Café", category: "Commerce" },
    },
  ];
  expect(filterEntities(rows, "cafe", "draft")).toHaveLength(1);
  expect(filterEntities(rows, "commerce", "published")).toHaveLength(0);
});
it("uses the server role and explicit grants for editing", () => {
  expect(canEdit({ role: "observateur", permissions: [] })).toBe(false);
  expect(canEdit({ role: "editeur", permissions: [] })).toBe(true);
  expect(canEdit({ role: "custom", permissions: ["contenu:modifier"] })).toBe(
    true,
  );
});

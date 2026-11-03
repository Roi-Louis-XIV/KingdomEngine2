import { test, expect, type Page } from "@playwright/test";

async function login(
  page: Page,
  user = "creator",
  password = "creator-browser-test",
) {
  await page.goto("/next#/?world=royaume-principal");
  await page.getByLabel("Identifiant", { exact: true }).fill(user);
  await page.getByLabel("Mot de passe", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Tableau de bord", exact: true }),
  ).toBeVisible();
}

test("creates, saves, publishes and reloads a real building without losing historical fields", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("link", { name: "Studio", exact: true }).click();
  await page
    .getByRole("link", { name: "Créer un bâtiment", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Nouveau bâtiment" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Enregistrer le brouillon" }).click();
  await expect(page.getByText("Donnez un nom à ce bâtiment")).toBeVisible();
  await expect(page.getByLabel("Nom du bâtiment")).toBeFocused();
  await page.getByLabel("Nom du bâtiment").fill("Observatoire de test");
  await page
    .getByLabel("Description", { exact: true })
    .fill("Une création réelle, enregistrée dans SQLite.");
  await page.getByRole("button", { name: "Enregistrer le brouillon" }).click();
  await expect(page.getByText("Révision 1", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Publier", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Royaume principal");
  await page.getByRole("button", { name: "Publier cette révision" }).click();
  await expect(
    page.getByText("Révision 1 publiée dans le moteur."),
  ).toBeVisible();
  await expect(
    page.getByText("Demande en attente de traitement"),
  ).toBeVisible();
  const response = await page.request.get("/api/content?entity_type=building", {
    headers: { "X-Kingdom-Server": "royaume-principal" },
  });
  const created = (await response.json()).find(
    (b: { payload: { name: string } }) =>
      b.payload.name === "Observatoire de test",
  );
  expect(created.status).toBe("published");
  await page.reload();
  await expect(page.getByLabel("Nom du bâtiment")).toHaveValue(
    "Observatoire de test",
  );
  await page.getByRole("link", { name: "Bibliothèque des bâtiments" }).click();
  await page
    .getByRole("article")
    .filter({
      has: page.getByRole("heading", { name: "Atelier existant", exact: true }),
    })
    .getByRole("link", { name: "Ouvrir le bâtiment" })
    .click();
  await page.getByLabel("Description", { exact: true }).fill("Description V3");
  await page.getByRole("button", { name: "Enregistrer le brouillon" }).click();
  await expect(page.getByText("Brouillon enregistré.")).toBeVisible();
  const saved = await (
    await page.request.get("/api/content/building/existing_atelier", {
      headers: { "X-Kingdom-Server": "royaume-principal" },
    })
  ).json();
  expect(saved.payload.future_extension).toEqual({ preserved: true });
  expect(saved.payload.modules).toEqual({ products: [] });
});

test("guards world changes, keeps search in URL, and discards stale responses", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("link", { name: "Studio", exact: true }).click();
  await page.getByRole("searchbox").fill("aucun résultat");
  await expect(page.getByText("Aucun bâtiment ne correspond")).toBeVisible();
  await expect(page).toHaveURL(/q=aucun/);
  await page.getByRole("button", { name: "Effacer la recherche" }).click();
  await expect(page.getByRole("searchbox")).toBeFocused();
  await page
    .getByRole("link", { name: "Créer un bâtiment", exact: true })
    .first()
    .click();
  await page.getByLabel("Nom du bâtiment").fill("Travail à garder");
  await page
    .getByLabel("Monde actif")
    .selectOption({ label: "Monde secondaire" });
  await expect(
    page.getByRole("dialog", { name: "Quitter sans enregistrer ?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Rester sur la fiche" }).click();
  await expect(page.getByLabel("Nom du bâtiment")).toHaveValue(
    "Travail à garder",
  );
  await page
    .getByLabel("Monde actif")
    .selectOption({ label: "Monde secondaire" });
  await page
    .getByRole("button", { name: "Quitter sans enregistrer", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Monde secondaire" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Studio", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Atelier du second monde" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Atelier existant" }),
  ).toHaveCount(0);
});

test("preserves edits on conflict and session expiry", async ({ page }) => {
  await login(page);
  await page.goto("/next#/studio/existing_atelier?world=royaume-principal");
  await page.getByLabel("Nom du bâtiment").fill("Ma saisie locale");
  const latest = await (
    await page.request.get("/api/content/building/existing_atelier", {
      headers: { "X-Kingdom-Server": "royaume-principal" },
    })
  ).json();
  await page.request.post("/api/content/building/existing_atelier", {
    headers: { "X-Kingdom-Server": "royaume-principal" },
    data: {
      payload: { ...latest.payload, name: "Autre auteur" },
      expected_version: latest.version,
    },
  });
  await page.getByRole("button", { name: "Enregistrer le brouillon" }).click();
  await expect(page.getByText("Une autre révision existe.")).toBeVisible();
  await expect(page.getByLabel("Nom du bâtiment")).toHaveValue(
    "Ma saisie locale",
  );
  await page
    .getByRole("button", { name: "Recharger la dernière version" })
    .click();
  await page.getByRole("button", { name: "Recharger", exact: true }).click();
  await expect(page.getByLabel("Nom du bâtiment")).toHaveValue("Autre auteur");
  await page.getByLabel("Nom du bâtiment").fill("Après reconnexion");
  await page.request.post("/api/auth/logout");
  await page.getByRole("button", { name: "Enregistrer le brouillon" }).click();
  await expect(page.getByText("Votre session a expiré")).toBeVisible();
  await page.getByRole("button", { name: "Se reconnecter" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Identifiant", { exact: true }).fill("creator");
  await dialog
    .getByLabel("Mot de passe", { exact: true })
    .fill("creator-browser-test");
  await dialog
    .getByRole("button", { name: "Se connecter", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel("Nom du bâtiment")).toHaveValue(
    "Après reconnexion",
  );
  await page.getByRole("button", { name: "Enregistrer le brouillon" }).click();
  await expect(page.getByText("Brouillon enregistré.")).toBeVisible();
});

test("supports mobile navigation, keyboard, reduced motion and read-only accounts", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await login(page, "reader", "reader-browser-test");
  await page.getByRole("button", { name: "Ouvrir la navigation" }).click();
  await page.getByRole("link", { name: "Studio", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Créer un bâtiment", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "Ouvrir le bâtiment" }).first().click();
  await expect(page.getByLabel("Nom du bâtiment")).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Enregistrer le brouillon" }),
  ).toBeDisabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Avancé", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Nature du bâtiment")).toBeVisible();
  await page.screenshot({
    path: "test-results/mobile-editor.png",
    fullPage: true,
  });
});

test("recovers from an API outage and renders the real dashboard on desktop", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "test-results/desktop-dashboard.png",
    fullPage: true,
  });
  await page.route("**/api/content?entity_type=building", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Maintenance temporaire" }),
    }),
  );
  await page.getByRole("link", { name: "Studio", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Maintenance temporaire");
  await page.unroute("**/api/content?entity_type=building");
  await page.getByRole("button", { name: "Réessayer" }).click();
  await expect(
    page.getByRole("link", { name: "Ouvrir le bâtiment" }).first(),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("ignores a late response from the previous world", async ({ page }) => {
  await login(page);
  const primary = await (
    await page.request.get("/api/content?entity_type=building", {
      headers: { "X-Kingdom-Server": "royaume-principal" },
    })
  ).json();
  let release: (() => void) | undefined;
  let intercepted = false;
  await page.route("**/api/content?entity_type=building", async (route) => {
    if (route.request().headers()["x-kingdom-server"] === "royaume-principal") {
      intercepted = true;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      await route.fulfill({ json: primary }).catch(() => {});
    } else await route.continue();
  });
  await page.getByRole("link", { name: "Studio", exact: true }).click();
  await expect.poll(() => intercepted).toBe(true);
  await page
    .getByLabel("Monde actif")
    .selectOption({ label: "Monde secondaire" });
  await expect(
    page.getByRole("heading", { name: "Monde secondaire" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Studio", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Atelier du second monde" }),
  ).toBeVisible();
  release?.();
  await expect(
    page.getByRole("heading", { name: "Atelier du second monde" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Après reconnexion" }),
  ).toHaveCount(0);
});

test("guards logout and restores dialog focus with Escape", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("link", { name: "Studio", exact: true }).click();
  await page
    .getByRole("link", { name: "Créer un bâtiment", exact: true })
    .first()
    .click();
  await page.getByLabel("Nom du bâtiment").fill("Rester connecté");
  await page
    .getByRole("button", { name: "Se déconnecter", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Se déconnecter", exact: true }),
  ).toBeFocused();
  await expect(page.getByLabel("Nom du bâtiment")).toHaveValue(
    "Rester connecté",
  );
});

test("has no serious accessibility violations in dashboard and editor", async ({
  page,
}) => {
  const { default: AxeBuilder } = await import("@axe-core/playwright");
  await login(page);
  const dashboard = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(dashboard.violations).toEqual([]);
  await page.getByRole("link", { name: "Studio", exact: true }).click();
  await page
    .getByRole("link", { name: "Créer un bâtiment", exact: true })
    .first()
    .click();
  const editor = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(editor.violations).toEqual([]);
  await page.getByRole("button", { name: "Avancé", exact: true }).click();
  await page.getByLabel("Nature du bâtiment").focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Nature du bâtiment")).not.toHaveValue("place");
  expect(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).scrollbarColor,
    ),
  ).not.toBe("auto");
});

# Procedencia y licencia de `foods.json`

`vendor/data/foods.json` es una base de datos **derivada**, construida por
`tools/build-food-db.mjs` a partir de dos fuentes con licencias distintas. Cada
registro lleva su origen en el campo `src`, y esto no es decorativo: determina
qué se puede hacer con él.

## Capa `src: "usda"` — genéricos

Valores nutricionales de **USDA FoodData Central** (SR Legacy y Foundation
Foods), publicados en **dominio público (CC0 1.0)**. Los nombres en español los
hemos escrito nosotros. Sin obligaciones.

<https://fdc.nal.usda.gov/>

## Capa `src: "off"` — productos de marca

Subconjunto de **Open Food Facts** filtrado a la marca Hacendado, bajo la
**Open Database License (ODbL) v1.0**.

<https://openfoodfacts.org> · <https://opendatacommons.org/licenses/odbl/1-0/>

Tres obligaciones concretas, y se cumplen así:

1. **Atribución.** Este fichero es el aviso, y viaja con los datos: `foods.json`
   incluye en su propio contenido el array `sources` con nombre, licencia y URL,
   de modo que la atribución no depende de que alguien lea este documento.
2. **Compartir igual.** Al empaquetar un subconjunto filtrado y normalizado,
   `foods.json` es una *Derivative Database* y se publica **bajo ODbL**, no bajo
   la MIT del resto del repositorio.
3. **Frontera con el código.** Las pantallas, gráficas y cálculos que consumen
   estos datos son *Produced Work* (ODbL §4.5b) y **no quedan contagiados**: el
   código sigue siendo MIT. La obligación alcanza a la base derivada, no a lo
   que se hace con ella.

**No se empaquetan imágenes de Open Food Facts.** Son CC BY-SA y esa sí es una
licencia que contagiaría a la obra que las incorpore.

## Lo que estos datos NO son

- **No son el catálogo actual de Mercadona.** Son productos con marca Hacendado
  que la comunidad subió a Open Food Facts en algún momento. Mercadona rota
  proveedores y códigos EAN, así que una parte importante está descatalogada.
  Para un diario de comidas da casi igual —un yogur natural sigue teniendo las
  mismas calorías— pero **para escanear un código de barras o consultar un
  precio, no sirven**.
- **No llevan precios.** No existe fuente libre con cobertura real.
- **No son una fuente clínica.** Los sube la comunidad desde la etiqueta.
  `tools/build-food-db.mjs` criba lo incoherente (~10 % de lo descargado), pero
  cribar no es verificar.

## Fuentes descartadas, y por qué

- **BEDCA** (base española de composición de alimentos): exige autorización
  escrita para uso electrónico no personal y **prohíbe modificar los datos** —
  normalizar a JSON o convertir kJ a kcal ya es modificarlos. Las copias en
  GitHub no lo arreglan: nadie puede licenciar lo que no posee.
- **La API de Mercadona**: no publica macronutrientes en absoluto, solo
  alérgenos e ingredientes. Además su `robots.txt` prohíbe `/api`.
- **Datasets de terceros** que dicen traer macros de Mercadona: o no los traen,
  o los rellenan con un modelo de visión leyendo fotos de etiquetas. Macros
  alucinadas es exactamente el defecto que hundió la v4.0 de este proyecto.

## Regenerar

```bash
node tools/build-food-db.mjs --limite 2000
```

# Magic UI provenance

The components in `components/magicui/` are adaptations of actual Magic UI component source inspected on 17 October 2026. They are not lookalike substitutes. The upstream source uses React and a class-name helper; the registry declares no additional runtime dependency for either component.

| Component | Official documentation | Inspected registry/source |
| --- | --- | --- |
| ShimmerButton | https://magicui.design/docs/components/shimmer-button | https://magicui.design/r/shimmer-button.json · https://raw.githubusercontent.com/magicuidesign/magicui/main/apps/www/registry/magicui/shimmer-button.tsx |
| GridPattern | https://magicui.design/docs/components/grid-pattern | https://magicui.design/r/grid-pattern.json · https://raw.githubusercontent.com/magicuidesign/magicui/main/apps/www/registry/magicui/grid-pattern.tsx |

License inspected: https://raw.githubusercontent.com/magicuidesign/magicui/main/LICENSE.md. Its MIT permission and copyright notice are retained in `LICENSE.magicui.txt`.

Adaptations: Tailwind utility classes and `cn()` become locally scoped plain CSS, retaining the SVG pattern/useId implementation and the ShimmerButton CSS-variable, container-unit, conic-gradient, slide/spin structure. Decorative markup is hidden from assistive technology, the label is a separate stacking layer, the local palette/radius are defaults, and reduced-motion preferences disable animation. No motion library, registry installer, package download, font service, or remote asset is required. React 19 and Next 16 are already installed at the repository root; this app declares the exact same versions.

Upstream URLs use its `main` branch and are recorded for attribution, not runtime loading. The checked-in adapted source is the reproducible version used by this preview.

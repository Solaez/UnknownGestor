/**
 * Configuración de estilos personalizados para NexusMods.
 * Puedes añadir, quitar o modificar selectores aquí para limpiar la interfaz.
 */
export const nexusCustomStyles = `
  /* Ocultar Footer y elementos de navegación innecesarios */
  footer, 
  .mt-auto.flex.w-full.justify-center[aria-label="Desktop footer"],
  #footer,
  .footer-social,
  .footer-links { 
    display: none !important; 
    visibility: hidden !important;
    height: 0 !important;
    overflow: hidden !important;
  }
    
  header {
    display: none !important;
  }



  /* Ocultar Publicidad y Banners Premium */
  .ad-unit,
  .ads-wrapper,
  .premium-banner,
  #header-ads,
  .sidebar-ads,
  .banner-ads,
  #top-ads { 
    display: none !important; 
    visibility: hidden !important;
    height: 0 !important;
  }

  /* Ajustes de Layout para una vista más limpia */
  body {
    padding-bottom: 0 !important;
    margin-bottom: 0 !important;
    overflow-x: hidden !important;
  }

  /* Opcional: Hacer la interfaz un poco más compacta */
  .container {
    max-width: 95% !important;
  }

  /*personalizado*/

  // ... dentro de nexusCustomStyles ...

  /* Clases de Tailwind corregidas con escapes (\\) */
  
  .flex.items-center.justify-center.gap-x-4.border-y.border-stroke-subdued.bg-surface-low.py-2 {
    display: none !important;
  }

  /* md:flex -> md\\:flex */
  .hidden.items-center.justify-center.gap-x-4.border-b.border-stroke-subdued.bg-surface-low.py-2.md\\:flex {
    display: none !important;
  }

  .w-full.space-y-6.border-b.border-stroke-subdued.pt-4.pb-6 {
    display: none !important;
  }

  /* top-[55px] -> top-\$$55px\$$ */
  .xs\\:-mx-6.xs\\:px-6.sticky.top-\$$55px\$$.z-20.-mx-4.-my-3.flex.flex-wrap.items-center.gap-4.px-4.py-3.sm\\:static.sm\\:mx-0.sm\\:w-full.sm\\:bg-transparent.sm\\:px-0.bg-surface-base {
    display: none !important;
  }

  div#filters-panel {
    display: none !important;
  }

  @media (min-width: 1024px) {
    .md\\:flex {
        display: none !important;
    }
  }

  /* md/:flex -> md\\/\\:flex */
  .md\\/\\:flex {
    display: none !important;
  }
// ... dentro de nexusCustomStyles ...

  /* --- TRANSFORMACIÓN DE TARJETAS (MOD TILES) A APP-CARDS --- */

  /* Ajustar el grid de NexusMods para que se parezca al de la app (4 columnas aprox) */
  .grid.grid-cols-1.gap-4.sm\\:grid-cols-2.lg\\:grid-cols-3.xl\\:grid-cols-4 {
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)) !important;
    gap: 20px !important;
    padding: 20px !important;
  }

  /* Contenedor principal de la tarjeta (AppCard style) */
  [data-e2eid="mod-tile"] {
    background: rgba(255, 255, 255, 0.03) !important;
    backdrop-filter: blur(10px) !important;
    border: 1px solid rgba(255, 255, 255, 0.08) !important;
    border-radius: 1rem !important;
    overflow: hidden !important;
    min-height: auto !important;
    box-shadow: none !important;
    display: flex !important;
    flex-direction: column !important;
    cursor: pointer !important;
    transition: all 0.2s ease !important;
  }

  [data-e2eid="mod-tile"]:hover {
    background: rgba(255, 255, 255, 0.06) !important;
    border-color: rgba(255, 255, 255, 0.15) !important;
  }

  /* Contenedor de la imagen (Cabecera de la tarjeta) */
  [data-e2eid="mod-tile"] .relative:first-child {
    height: 150px !important;
    background: linear-gradient(135deg, rgba(218, 142, 53, 0.6), rgba(218, 142, 53, 0.26) 50%, #0d0d1a) !important;
    position: relative !important;
    overflow: hidden !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
  }

  /* Imagen dentro del contenedor */
  [data-e2eid="mod-tile"] img.absolute {
    position: absolute !important;
    inset: 0 !important;
    width: 100% !important;
    height: 100% !important;
    object-fit: cover !important;
    opacity: 0.85 !important;
    transition: transform 0.3s ease !important;
  }

  [data-e2eid="mod-tile"]:hover img.absolute {
    transform: scale(1.05) !important;
  }

  /* Cuerpo de la tarjeta (Textos) */
  [data-e2eid="mod-tile"] .px-3.pt-3.pb-5 {
    padding: 10px 14px !important;
    display: flex !important;
    flex-direction: column !important;
    background: transparent !important;
    min-height: 60px !important; /* Espacio para título y categoría */
  }

  /* Asegurar que el contenedor de textos sea visible */
  .divide-y {
    border: none !important;
    display: block !important;
  }

  /* Título del Mod */
  [data-e2eid="mod-tile-title"] {
    font-size: 14px !important;
    font-weight: 700 !important;
    color: #ffffff !important;
    line-height: 1.2 !important;
    display: -webkit-box !important;
    -webkit-line-clamp: 1 !important;
    -webkit-box-orient: vertical !important;
    overflow: hidden !important;
    margin-bottom: 2px !important;
  }

  /* Subtítulo (Categoría/Juego) */
  [data-e2eid="mod-tile-category"],
  [data-e2eid="mod-tile-game"] {
    font-size: 12px !important;
    color: rgba(255, 255, 255, 0.5) !important;
    display: inline-block !important;
    text-transform: lowercase !important;
  }

  /* Ocultar solo lo innecesario sin romper el flujo de los textos */
  [data-e2eid="mod-tile-summary"],
  [data-e2eid="mod-tile-updated"],
  [data-e2eid="mod-tile-uploaded"],
  [data-e2eid="user-link"],
  .mt-auto.flex.min-h-8,
  button[aria-label="Mod options"],
  .bg-surface-translucent-low,
  .rotate-45.align-middle,
  .divide-y > * + * {
    display: none !important;
  }

  /* Forzar visibilidad del bloque de categoría */
  [data-e2eid="mod-tile-game"] {
    margin-right: 4px !important;
  }
  [data-e2eid="mod-tile-game"]::after {
    content: "·" !important;
    margin-left: 4px !important;
  }
    img.w-screen.min-h-screen.scale-125 {
    display: none !important;
}
    .ads-holder.clearfix.ads-top {
    display: none !important;
}
.ads-holder.clearfix.ads-bottom {
    display: none !important;
}
    @media (min-width: 1024px) {
    body.new-head {
        margin-top: 0 !important;
    }
}
body.new-head {
        margin-top: 0 !important;
    }
@media (max-width: 1280px) {
    .wrapper {
        max-width: 100% !important;
        padding: 0 10px;
    }
}
     .wrapper {
        max-width: 100% !important;
        padding: 0 10px;
    }

  /* Ocultar anuncios de Google Ads (bottom rail, iframes de ads) */
  #pw-oop-bottom_rail,
  div[id*="google_ads"],
  div[data-google-query-id],
  iframe[title*="Contenido de anuncios"],
  .pw-tag,
  div[id*="bottom_rail"] {
    display: none !important;
    visibility: hidden !important;
    height: 0 !important;
    width: 0 !important;
    overflow: hidden !important;
    position: absolute !important;
    left: -9999pxmargin-left: 4px !important;
  }
`;

/*-------------------Gamebanana------------------*/
/*-------------------------------------------------------------------*/
/*--------------------------------------------------------------------*/

export const gamebananaCustomStyles = `
 div#PageFooter {
    display: none !important;
}
    nav#PrimaryNav {
    display: none !important;
}
    column.xs-h.xs-uh-11.sm-h.sm-uh-8.md-5.lg-4 {
    display: none !important;
}
    div#AuxiliaryColumn {
    display: none !important;
}
    module#TopGamesModule {
    display: none !important;
}
    .TabsWrapper {
    display: none;
}
    .SlideThumbnails {
    display: none !important;
}
    header#MainContentHeader {
    display: none;
}
    module#HeadlineLeaderboardModule {
    display: none !important;
}
    form.Flow {
    display: none;
}
    .PageInfoWrapper {
    display: none;
}
    .InGridPlaceholder {
    display: none !important;
}
    wrapper#SubNavigator {
    display: none;
}
    #ContentGrid row>column.lg-8 {
    -ms-flex-preferred-size: 66.667%;
    flex-basis: 66.667%;
    max-width: 100% !important;
}
    module#MainColumnLeaderboardModule {
    display: none !important;
}
    div#pw-oop-bottom_rail {
    display: none !important;
}
    div#ContentGrid {
    display: flex !important;
    flex-direction: column;
}
    #FeaturesSliderModule .Content {
    grid-template-columns: 1fr !important;
}
    wrapper#BodyWrapper {
    margin: 0 !important;
}
    #BodyWrapper {
    max-width: none !important;
}
`;
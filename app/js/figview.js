/* Serializable figure presentation, independent of analysis views and legacy figure fields. */
export const geoTrackOptions = (view = {}) => ({ image: true, total: true, species: false, BI: false, ii: false, manual: false, secs: false, marks: false, ...view.tracks });

/** Read an override or the current inherited presentation without creating saved state. */
export function figureViewOf(figure, logView, geoView, geoAxis) {
  if (figure.views?.[figure.type]) return figure.views[figure.type];
  if (figure.type === 'geolog') {
    const view = { imgMode: logView.imgMode, imgPanels: logView.imgPanels, overlay: logView.overlay,
      hideExcl: logView.hideExcl, alpha: figure.alpha, height: 700, axis: geoAxis, ...geoView, ...figure.geoView };
    view.style = { imgAspect: logView.style?.imgAspect || 'keep', imgW: logView.style?.imgW || 64,
      imgStretch: logView.style?.imgStretch || 1, ...view.style };
    const tracks = geoTrackOptions(view);
    if (!figure.geoView && view.style && Array.isArray(view.style.colHide)) {
      const dropRec = figure.geoFeatures != null, dropImg = tracks.image;
      if (dropRec || dropImg) view.style = { ...view.style, colHide: view.style.colHide.filter((id) => (!dropRec || !id.startsWith('rec:')) && (!dropImg || !id.startsWith('image:'))) };
    }
    return { ...view, tracks };
  }
  return { ...logView, keepRatio: !!figure.keepRatio, alpha: figure.alpha, depthFrom: figure.secFrom, depthTo: figure.secTo,
    ...(figure.type === 'core' ? { tracks: figure.tracks || logView.tracks, records: figure.recs, imgMode: 'enh', imgPanels: figure.corePanels, hideExcl: !!figure.coreHideExcl } : {}),
    ...(figure.type === 'range' ? { axis: figure.rangeAxis || logView.axis } : {}) };
}

/** The first edit snapshots inherited settings; later edits address only this figure type and tab. */
export function editFigureView(figure, logView, geoView, geoAxis) {
  if (figure.type === 'geolog') {
    // Complete the legacy composition only on editing, so old projects still inherit missing fields.
    figure.geoView = JSON.parse(JSON.stringify(figureViewOf(figure, logView, geoView, geoAxis)));
    return figure.geoView;
  }
  figure.views ||= {};
  if (!figure.views[figure.type]) {
    const view = figureViewOf(figure, logView, geoView, geoAxis);
    figure.views[figure.type] = JSON.parse(JSON.stringify(view));
  }
  return figure.views[figure.type];
}

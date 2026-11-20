// SedCoreTool web — interface strings (es / en).

const D = {
  es: {
    'app.tagline': 'Análisis icnológico de imágenes de sondeos',
    'top.new': 'Nuevo', 'top.open': 'Abrir proyecto', 'top.save': 'Guardar proyecto', 'top.help': 'Ayuda',
    's1': 'Sondeo e imagen', 's2': 'Realce de la imagen', 's3': 'Detección automática', 's4': 'Intervalos de análisis',
    'sec.add': 'Añadir imágenes…', 'sec.section': 'Sección', 'sec.name': 'Nombre', 'sec.top': 'Techo', 'sec.bottom': 'Muro',
    'sec.units': 'Unidades', 'sec.rotate': 'Girar 90°', 'sec.delete': 'Quitar sección',
    'sec.depthNote': 'Profundidades del borde superior e inferior de la zona de análisis.',
    'roi.title': 'Zona de análisis', 'roi.draw': 'Dibujar zona', 'roi.reset': 'Imagen completa',
    'age.title': 'Modelo de edad', 'age.ph': 'profundidad, edad\n0, 0\n150, 12.5', 'age.file': 'Cargar CSV…',
    'age.units': 'Unidad de edad', 'age.none': 'Sin modelo de edad', 'age.ok': '{n} puntos · {a}–{b} {u}',
    'f.preset': 'Ajuste', 'f.p.none': 'Sin realce', 'f.p.levels': 'Niveles y contraste (Dorador y Rodríguez-Tovar, 2014)',
    'f.p.local': 'Contraste local', 'f.p.strong': 'Ecualizado + contraste local (gris)', 'f.p.custom': 'Personalizado',
    'f.channel': 'Canal', 'f.blackPoint': 'Punto negro', 'f.whitePoint': 'Punto blanco', 'f.gamma': 'Gamma',
    'f.brightness': 'Brillo', 'f.contrast': 'Contraste', 'f.saturation': 'Saturación', 'f.localAmount': 'Contraste local',
    'f.localRadius': 'Radio local (px)', 'f.equalize': 'Ecualizar histograma', 'f.invert': 'Invertir',
    'ch.rgb': 'Color', 'ch.gray': 'Gris', 'ch.r': 'Rojo', 'ch.g': 'Verde', 'ch.b': 'Azul',
    'd.method': 'Método', 'd.adaptive': 'Umbral adaptativo (local)', 'd.global': 'Umbral global',
    'd.polarity': 'Las trazas son', 'd.dark': 'más oscuras', 'd.light': 'más claras', 'd.both': 'oscuras o claras',
    'd.offset': 'Sensibilidad (diferencia)', 'd.radius': 'Ventana local (px)', 'd.threshold': 'Umbral (0–255)',
    'd.minArea': 'Tamaño mínimo (px)', 'd.smooth': 'Suavizado', 'd.run': 'Detectar candidatos', 'd.clear': 'Quitar candidatos',
    'd.note': 'Vuelve a detectar sin tocar lo que ya has identificado.', 'd.result': '{n} candidatos detectados',
    'a.bin': 'Píxeles por intervalo', 'a.binNote': '≈ {v} {u} por dato', 'a.inclPred': 'Contar identificaciones automáticas',
    'a.countCand': 'Contar candidatos sin revisar como bioturbación', 'a.note': 'Los artefactos y las zonas excluidas nunca cuentan.',
    'tool.select': 'Seleccionar y mover (V)', 'tool.wand': 'Varita: seleccionar por color (W)', 'tool.brush': 'Pincel (B)',
    'tool.lasso': 'Lazo (L)', 'tool.erase': 'Borrador (E)', 'tool.exclude': 'Excluir zona: grietas, huecos, muestras (X). Mayús + arrastrar = rectángulo',
    'tool.include': 'Recuperar zona excluida', 'tool.pan': 'Mano (H o espacio)', 'tool.size': 'Tamaño', 'tool.tol': 'Tolerancia',
    'view.fit': 'Ajustar', 'view.orig': 'Original', 'view.overlay': 'Capa', 'undo': 'Deshacer (Ctrl+Z / ⌘Z)',
    'redo': 'Rehacer (Ctrl+Y / Ctrl+Mayús+Z / ⌘Mayús+Z)',
    'empty.title': 'Añade una imagen de sondeo', 'empty.body': 'JPG, PNG o TIFF. Las imágenes se procesan en tu navegador y no se envían a ningún sitio.',
    'empty.example': 'Abrir ejemplo',
    'tab.classes': 'Icnotaxones', 'tab.object': 'Objeto', 'tab.learn': 'Aprendizaje', 'tab.results': 'Resultados',
    'cls.undet': 'Bioturbación indeterminada', 'cls.mottled': 'Moteado (bioturbación difusa)', 'cls.artifact': 'Artefacto (no bioturbación)',
    'cls.add': 'Añadir icnotaxón', 'cls.new': 'Nuevo icnotaxón', 'cls.hint': 'Clic para activar. Teclas 1–9 y 0 asignan la clase al objeto seleccionado.',
    'cls.counts': '{n} obj. · {e} ej.',
    'obj.none': 'Selecciona un objeto con la herramienta de selección, o pulsa N para ir al siguiente sin revisar.',
    'obj.class': 'Clase', 'obj.unassigned': '— sin identificar —', 'obj.status': 'Estado', 'obj.labeled': 'identificado por ti',
    'obj.predicted': 'identificado automáticamente', 'obj.candidate': 'candidato sin revisar', 'obj.suggest': 'Sugerencia',
    'obj.depth': 'Profundidad', 'obj.size': 'Tamaño', 'obj.area': 'Área', 'obj.shape': 'Forma', 'obj.accept': 'Aceptar sugerencia (Enter)',
    'obj.delete': 'Eliminar (Supr)', 'obj.next': 'Siguiente sin revisar (N)', 'obj.autoNext': 'Saltar al siguiente al asignar', 'obj.novel': 'no se parece a nada conocido',
    'obj.elong': 'alargamiento', 'obj.vert': 'verticalidad',
    'l.intro': 'Cada objeto que identificas es un ejemplo. Con dos o más ejemplos, el programa propone la clase de los demás según su forma, tamaño y color, y mejora con cada corrección.',
    'l.examples': 'Ejemplos', 'l.accuracy': 'Acierto estimado', 'l.accNA': 'necesita 2 clases', 'l.pending': '{n} sugerencias por encima del umbral',
    'l.thr': 'Confianza mínima', 'l.novelty': 'Tolerancia a formas nuevas', 'l.accept': 'Aceptar sugerencias', 'l.export': 'Exportar modelo',
    'l.import': 'Importar modelo…', 'l.library': 'Ejemplos importados', 'l.clearLib': 'Olvidar importados', 'l.none': 'Aún no hay ejemplos.',
    'r.mean': 'Bioturbación media', 'r.area': 'Superficie analizada', 'r.objects': 'Objetos contados', 'r.byClass': 'Por icnotaxón (% de la superficie)',
    'r.depth': 'Prof.', 'r.age': 'Edad', 'r.manual': 'manual', 'r.tooMany': 'Tabla limitada a {n} filas; exporta el CSV para verlas todas.',
    'r.csv': 'Resultados (CSV)', 'r.objectsCsv': 'Objetos (CSV)', 'r.mask': 'Máscara (PNG)', 'r.palette': 'Paleta (JSON)',
    'r.empty': 'Los resultados aparecen al detectar o marcar bioturbación.', 'r.manualNote': 'BI e ii manuales: elige un valor para registrar tu estimación visual junto a la automática.',
    'p.pct': 'Bioturbación %',
    'busy': 'Procesando…', 'saved': 'Archivo guardado', 'loaded': 'Proyecto cargado', 'err.image': 'No se pudo leer la imagen: {m}',
    'err.largeTiffLayout': 'Este TIFF supera el límite del decodificador de formatos antiguos. Use TIFF por teselas o bandas en escala de grises o RGB de 8 o 16 bits compatible.',
    'err.project': 'Ese archivo no es un proyecto de SedCoreTool.', 'confirm.new': '¿Empezar un proyecto nuevo? Se perderá lo que no hayas guardado.',
    'confirm.yes': 'Sí, empezar de nuevo', 'confirm.no': 'Cancelar', 'example.name': 'Ejemplo idealizado (V2.1)',
    'status.depth': 'Prof. {d} {u}', 'help.title': 'Cómo funciona', 'help.close': 'Cerrar',
    'help.body': '<ol><li><b>Sondeo e imagen.</b> Añade una o varias imágenes (una por sección), indica techo y muro y, si quieres, un modelo de edad. Dibuja la zona de análisis para dejar fuera la escala y los bordes.</li><li><b>Realce.</b> Ajusta niveles, contraste o contraste local hasta que las trazas se vean bien.</li><li><b>Detección.</b> Detecta candidatos automáticamente. Completa o corrige con la varita, el pincel, el lazo y el borrador. Excluye grietas, huecos y zonas muestreadas.</li><li><b>Identificación.</b> Selecciona un objeto y pulsa 1–9 para asignar el icnotaxón (0 = artefacto). El programa aprende y propone la clase del resto.</li><li><b>Resultados.</b> Porcentaje de bioturbación, BI, ii y porcentaje por icnotaxón por intervalo, junto a la imagen. Exporta CSV, máscara y proyecto.</li></ol><p><b>Atajos:</b> V seleccionar · W varita · B pincel · L lazo · E borrador · X excluir · H mano · O original · F ajustar · N siguiente · Enter aceptar · Supr eliminar · [ ] tamaño · Ctrl+rueda zoom · Ctrl+Z o ⌘Z deshacer · Ctrl+Y, Ctrl+Mayús+Z o ⌘Mayús+Z rehacer. Mayús añade al objeto seleccionado; Alt resta.</p>',
  },
  en: {
    'app.tagline': 'Ichnological analysis of core images',
    'top.new': 'New', 'top.open': 'Open project', 'top.save': 'Save project', 'top.help': 'Help',
    's1': 'Core and image', 's2': 'Image enhancement', 's3': 'Automatic detection', 's4': 'Analysis intervals',
    'sec.add': 'Add images…', 'sec.section': 'Section', 'sec.name': 'Name', 'sec.top': 'Top', 'sec.bottom': 'Bottom',
    'sec.units': 'Units', 'sec.rotate': 'Rotate 90°', 'sec.delete': 'Remove section',
    'sec.depthNote': 'Depths of the top and bottom edges of the analysis area.',
    'roi.title': 'Analysis area', 'roi.draw': 'Draw area', 'roi.reset': 'Whole image',
    'age.title': 'Age model', 'age.ph': 'depth, age\n0, 0\n150, 12.5', 'age.file': 'Load CSV…',
    'age.units': 'Age unit', 'age.none': 'No age model', 'age.ok': '{n} points · {a}–{b} {u}',
    'f.preset': 'Preset', 'f.p.none': 'No enhancement', 'f.p.levels': 'Levels and contrast (Dorador & Rodríguez-Tovar, 2014)',
    'f.p.local': 'Local contrast', 'f.p.strong': 'Equalised + local contrast (grey)', 'f.p.custom': 'Custom',
    'f.channel': 'Channel', 'f.blackPoint': 'Black point', 'f.whitePoint': 'White point', 'f.gamma': 'Gamma',
    'f.brightness': 'Brightness', 'f.contrast': 'Contrast', 'f.saturation': 'Saturation', 'f.localAmount': 'Local contrast',
    'f.localRadius': 'Local radius (px)', 'f.equalize': 'Equalise histogram', 'f.invert': 'Invert',
    'ch.rgb': 'Colour', 'ch.gray': 'Grey', 'ch.r': 'Red', 'ch.g': 'Green', 'ch.b': 'Blue',
    'd.method': 'Method', 'd.adaptive': 'Adaptive (local) threshold', 'd.global': 'Global threshold',
    'd.polarity': 'Traces are', 'd.dark': 'darker', 'd.light': 'lighter', 'd.both': 'darker or lighter',
    'd.offset': 'Sensitivity (difference)', 'd.radius': 'Local window (px)', 'd.threshold': 'Threshold (0–255)',
    'd.minArea': 'Minimum size (px)', 'd.smooth': 'Smoothing', 'd.run': 'Detect candidates', 'd.clear': 'Remove candidates',
    'd.note': 'Re-detection keeps everything you have already identified.', 'd.result': '{n} candidates detected',
    'a.bin': 'Pixels per interval', 'a.binNote': '≈ {v} {u} per data point', 'a.inclPred': 'Count automatic identifications',
    'a.countCand': 'Count unreviewed candidates as bioturbation', 'a.note': 'Artefacts and excluded areas never count.',
    'tool.select': 'Select and move (V)', 'tool.wand': 'Wand: select by colour (W)', 'tool.brush': 'Brush (B)',
    'tool.lasso': 'Lasso (L)', 'tool.erase': 'Eraser (E)', 'tool.exclude': 'Exclude area: cracks, voids, samples (X). Shift + drag = rectangle',
    'tool.include': 'Restore excluded area', 'tool.pan': 'Hand (H or space)', 'tool.size': 'Size', 'tool.tol': 'Tolerance',
    'view.fit': 'Fit', 'view.orig': 'Original', 'view.overlay': 'Overlay', 'undo': 'Undo (Ctrl+Z / ⌘Z)',
    'redo': 'Redo (Ctrl+Y / Ctrl+Shift+Z / ⌘Shift+Z)',
    'empty.title': 'Add a core image', 'empty.body': 'JPG, PNG or TIFF. Images are processed in your browser and never uploaded.',
    'empty.example': 'Open example',
    'tab.classes': 'Ichnotaxa', 'tab.object': 'Object', 'tab.learn': 'Learning', 'tab.results': 'Results',
    'cls.undet': 'Undetermined bioturbation', 'cls.mottled': 'Mottling (diffuse bioturbation)', 'cls.artifact': 'Artefact (not bioturbation)',
    'cls.add': 'Add ichnotaxon', 'cls.new': 'New ichnotaxon', 'cls.hint': 'Click to make active. Keys 1–9 and 0 assign the class to the selected object.',
    'cls.counts': '{n} obj. · {e} ex.',
    'obj.none': 'Select an object with the selection tool, or press N to jump to the next unreviewed one.',
    'obj.class': 'Class', 'obj.unassigned': '— unidentified —', 'obj.status': 'Status', 'obj.labeled': 'identified by you',
    'obj.predicted': 'identified automatically', 'obj.candidate': 'unreviewed candidate', 'obj.suggest': 'Suggestion',
    'obj.depth': 'Depth', 'obj.size': 'Size', 'obj.area': 'Area', 'obj.shape': 'Shape', 'obj.accept': 'Accept suggestion (Enter)',
    'obj.delete': 'Delete (Del)', 'obj.next': 'Next unreviewed (N)', 'obj.autoNext': 'Jump to next after assigning', 'obj.novel': 'unlike anything known',
    'obj.elong': 'elongation', 'obj.vert': 'verticality',
    'l.intro': 'Every object you identify is an example. With two or more examples the program suggests the class of the rest from their shape, size and colour, and improves with every correction.',
    'l.examples': 'Examples', 'l.accuracy': 'Estimated accuracy', 'l.accNA': 'needs 2 classes', 'l.pending': '{n} suggestions above threshold',
    'l.thr': 'Minimum confidence', 'l.novelty': 'Tolerance to new shapes', 'l.accept': 'Accept suggestions', 'l.export': 'Export model',
    'l.import': 'Import model…', 'l.library': 'Imported examples', 'l.clearLib': 'Forget imported', 'l.none': 'No examples yet.',
    'r.mean': 'Mean bioturbation', 'r.area': 'Analysed surface', 'r.objects': 'Objects counted', 'r.byClass': 'By ichnotaxon (% of surface)',
    'r.depth': 'Depth', 'r.age': 'Age', 'r.manual': 'manual', 'r.tooMany': 'Table limited to {n} rows; export the CSV to see all.',
    'r.csv': 'Results (CSV)', 'r.objectsCsv': 'Objects (CSV)', 'r.mask': 'Mask (PNG)', 'r.palette': 'Palette (JSON)',
    'r.empty': 'Results appear once bioturbation is detected or drawn.', 'r.manualNote': 'Manual BI and ii: pick a value to record your visual estimate next to the automatic one.',
    'p.pct': 'Bioturbation %',
    'busy': 'Processing…', 'saved': 'File saved', 'loaded': 'Project loaded', 'err.image': 'Could not read the image: {m}',
    'err.largeTiffLayout': 'This TIFF exceeds the legacy decoder limit. Use a tiled or stripped TIFF with a supported 8- or 16-bit grayscale or RGB layout.',
    'err.project': 'That file is not a SedCoreTool project.', 'confirm.new': 'Start a new project? Anything unsaved will be lost.',
    'confirm.yes': 'Yes, start over', 'confirm.no': 'Cancel', 'example.name': 'Idealised example (V2.1)',
    'status.depth': 'Depth {d} {u}', 'help.title': 'How it works', 'help.close': 'Close',
    'help.body': '<ol><li><b>Core and image.</b> Add one or more images (one per section), set top and bottom depths and, optionally, an age model. Draw the analysis area to leave out the scale bar and core edges.</li><li><b>Enhancement.</b> Adjust levels, contrast or local contrast until traces stand out.</li><li><b>Detection.</b> Detect candidates automatically. Complete or correct them with the wand, brush, lasso and eraser. Exclude cracks, voids and sampled areas.</li><li><b>Identification.</b> Select an object and press 1–9 to assign the ichnotaxon (0 = artefact). The program learns and suggests the class of the rest.</li><li><b>Results.</b> Bioturbation percentage, BI, ii and percentage per ichnotaxon per interval, beside the image. Export CSV, mask and project.</li></ol><p><b>Shortcuts:</b> V select · W wand · B brush · L lasso · E eraser · X exclude · H hand · O original · F fit · N next · Enter accept · Del delete · [ ] size · Ctrl+wheel zoom · Ctrl+Z or ⌘Z undo · Ctrl+Y, Ctrl+Shift+Z or ⌘Shift+Z redo. Shift adds to the selected object; Alt subtracts.</p>',
  },
};

Object.assign(D.es, {
  'mode.section': 'Sección', 'mode.log': 'Registro del sondeo',
  'proj.label': 'Proyecto', 'proj.title': 'Proyectos', 'proj.untitled': 'Proyecto sin título',
  'proj.newPh': 'Nombre del nuevo proyecto (p. ej. ODP 977A)', 'proj.create': 'Crear proyecto',
  'proj.test': 'Abrir sondeo de prueba (IODP U1385I)', 'proj.ideal': 'Abrir ejemplo idealizado',
  'proj.import': 'Importar archivo…', 'proj.export': 'Exportar este proyecto',
  'proj.note': 'Cada proyecto guarda sus imágenes, profundidades, modelo de edad, bioturbación y registros. Se guardan solos en este navegador y en este ordenador. Exporta un archivo para copiarlos a otro equipo o como copia de seguridad.',
  'proj.open': 'Abrir', 'proj.rename': 'Renombrar', 'proj.del': 'Borrar', 'proj.delConfirm': '¿Borrar? Pulsa otra vez',
  'proj.sections': '{n} secciones', 'proj.current': 'abierto', 'proj.none': 'Todavía no hay proyectos guardados.',
  'save.saved': 'Guardado', 'save.saving': 'Guardando…', 'save.dirty': 'Cambios sin guardar', 'save.off': 'Sin guardado automático: exporta el proyecto', 'save.error': 'Error al guardar',
  'save.retry': 'Reintentar guardado', 'save.pending': 'No se pudo guardar. Tus cambios siguen abiertos: reintenta el guardado o exporta este proyecto antes de abrir otro.',
  'sec.maxMP': 'Tamaño máximo al añadir imágenes', 'sec.maxMPNote': 'Las imágenes más grandes se reducen al añadirlas, para trabajar con fluidez. El archivo original se guarda completo: después puedes cambiar la resolución de cada sección en «Resolución de esta sección».', 'mp.orig': 'Sin reducir (si cabe en memoria)',
  'log.axis': 'Eje vertical', 'log.depth': 'Profundidad', 'log.age': 'Edad', 'log.window': 'Ventana de intervalo', 'log.from': 'Desde', 'log.to': 'Hasta',
  'log.all': 'Todo el sondeo', 'log.height': 'Altura del gráfico', 'log.tracks': 'Columnas', 'log.image': 'Imagen', 'log.total': 'Bioturbación (%)',
  'log.species': 'Por icnotaxón (%)', 'log.manual': 'Índices manuales (marca negra)', 'log.imgMode': 'Imagen', 'log.enh': 'Realzada', 'log.orig': 'Original',
  'log.overlay': 'Superponer bioturbación', 'log.records': 'Registros externos', 'log.addRec': 'Añadir registro (CSV, TXT, Excel)…',
  'log.recNote': 'La columna de profundidad debe estar en las mismas unidades que el sondeo; la de edad, en las del modelo de edad.',
  'log.svg': 'Exportar SVG', 'log.csv': 'Exportar CSV', 'log.csvMean': 'Registros: media del intervalo', 'log.csvPoint': 'Registros: valor en el centro', 'log.csvModeTip': 'Cómo se escriben los registros externos en el CSV: la media de sus muestras dentro de cada intervalo (con su número), o su valor interpolado en el centro del intervalo, sin cruzar huecos mayores que tres veces su espaciado mediano', 'log.empty': 'Añade secciones para ver el registro del sondeo.', 'log.reverse': 'invertir',
  'log.points': 'puntos', 'log.noRecords': 'Sin registros. Añade geoquímica, color, susceptibilidad…',
  'log.subtitle': '{n} secciones · intervalos de {b} px · ventana {from}–{to} {u}',
  'rec.title': 'Añadir registro', 'rec.name': 'Nombre del registro', 'rec.x': 'Columna de profundidad o edad', 'rec.axis': 'Esa columna es',
  'rec.cols': 'Columnas a representar', 'rec.add': 'Añadir', 'rec.err': 'No se pudo leer la tabla: {m}', 'rec.short': 'hacen falta al menos dos columnas numéricas',
});
Object.assign(D.en, {
  'mode.section': 'Section', 'mode.log': 'Core log',
  'proj.label': 'Project', 'proj.title': 'Projects', 'proj.untitled': 'Untitled project',
  'proj.newPh': 'New project name (e.g. ODP 977A)', 'proj.create': 'Create project',
  'proj.test': 'Open test core (IODP U1385I)', 'proj.ideal': 'Open idealised example',
  'proj.import': 'Import file…', 'proj.export': 'Export this project',
  'proj.note': 'Each project keeps its images, depths, age model, bioturbation and records. Projects save automatically in this browser on this computer. Export a file to move them to another computer or as a backup.',
  'proj.open': 'Open', 'proj.rename': 'Rename', 'proj.del': 'Delete', 'proj.delConfirm': 'Delete? Click again',
  'proj.sections': '{n} sections', 'proj.current': 'open', 'proj.none': 'No saved projects yet.',
  'save.saved': 'Saved', 'save.saving': 'Saving…', 'save.dirty': 'Unsaved changes', 'save.off': 'No autosave: export the project', 'save.error': 'Save failed',
  'save.retry': 'Retry save', 'save.pending': 'Saving failed. Your changes are still open: retry saving or export this project before opening another.',
  'sec.maxMP': 'Maximum size when adding images', 'sec.maxMPNote': 'Larger images are reduced when they are added, so that work stays fluid. The original file is kept at full resolution: you can change the resolution of each section later in «Resolution of this section».', 'mp.orig': 'No reduction (if it fits in memory)',
  'log.axis': 'Vertical axis', 'log.depth': 'Depth', 'log.age': 'Age', 'log.window': 'Interval window', 'log.from': 'From', 'log.to': 'To',
  'log.all': 'Whole core', 'log.height': 'Plot height', 'log.tracks': 'Tracks', 'log.image': 'Image', 'log.total': 'Bioturbation (%)',
  'log.species': 'By ichnotaxon (%)', 'log.manual': 'Manual indices (black mark)', 'log.imgMode': 'Image', 'log.enh': 'Enhanced', 'log.orig': 'Original',
  'log.overlay': 'Overlay bioturbation', 'log.records': 'External records', 'log.addRec': 'Add record (CSV, TXT, Excel)…',
  'log.recNote': 'A depth column must use the same units as the core; an age column, those of the age model.',
  'log.svg': 'Export SVG', 'log.csv': 'Export CSV', 'log.csvMean': 'Records: interval mean', 'log.csvPoint': 'Records: value at the centre', 'log.csvModeTip': 'How external records are written in the CSV: the mean of their samples inside each interval (with their number), or their value interpolated at the interval centre, never across gaps wider than three times their median spacing', 'log.empty': 'Add sections to see the core log.', 'log.reverse': 'reverse',
  'log.points': 'points', 'log.noRecords': 'No records. Add geochemistry, colour, susceptibility…',
  'log.subtitle': '{n} sections · {b} px intervals · window {from}–{to} {u}',
  'rec.title': 'Add record', 'rec.name': 'Record name', 'rec.x': 'Depth or age column', 'rec.axis': 'That column is',
  'rec.cols': 'Columns to plot', 'rec.add': 'Add', 'rec.err': 'Could not read the table: {m}', 'rec.short': 'at least two numeric columns are needed',
});

Object.assign(D.es, {
  'f.p.dorador2014': 'Dorador et al. (2014): niveles, contraste y vibrance', 'f.p.clahe2019': 'CLAHE (Miguez-Salas et al., 2019; Fiji)',
  'f.p.levels': 'Niveles y contraste (genérico)', 'f.builtin': 'Ajustes incluidos', 'f.mine': 'Mis ajustes',
  'f.src.dorador2014': 'Dorador, Rodríguez-Tovar e IODP Exp. 339 (2014, Facies 60): Niveles → Brillo/Contraste → Vibrance/Saturación. Niveles automáticos por percentiles (en el artículo se eligen en cada imagen); gamma automática dentro del rango publicado (0,19–1; media 0,76); vibrance −31 y saturación −66 son las medias publicadas.',
  'f.src.clahe2019': 'Miguez-Salas, Dorador y Rodríguez-Tovar (2019, Marine Geology 413): ecualización adaptativa con límite de contraste (CLAHE) de Fiji. Valores por defecto de Fiji: bloque 127 px, pendiente 3.',
  'f.src.none': '', 'f.src.levels': 'Punto de partida genérico, sin fuente publicada.', 'f.src.local': 'Punto de partida genérico, sin fuente publicada.', 'f.src.strong': 'Punto de partida genérico, sin fuente publicada.',
  'f.auto': 'Niveles automáticos (percentiles 0,5 % y 99,5 % de la zona de análisis)', 'f.vibrance': 'Vibrance', 'f.claheBlock': 'CLAHE: bloque (px; 0 = no)', 'f.claheSlope': 'CLAHE: pendiente máxima',
  'f.saveName': 'Nombre para guardar este ajuste', 'f.save': 'Guardar ajuste', 'f.del': 'Borrar este ajuste guardado', 'f.applyAll': 'Aplicar este ajuste a todas las secciones',
  'f.saved': 'Ajuste «{n}» guardado (realce + detección)', 'f.appliedAll': 'Ajuste aplicado a {n} secciones',
  'vis.title': 'Qué mira el clasificador', 'vis.f.shape': 'Forma y color (12 rasgos)', 'vis.d.shape': 'Área, ejes, alargamiento, verticalidad, compacidad, color y contraste de cada traza. Rápido y explicable.',
  'vis.f.vision': 'Modelo de visión (DINOv2)', 'vis.d.vision': 'Un modelo ya entrenado con millones de imágenes convierte el recorte de cada traza en 384 números que resumen su forma y textura. El clasificador aprende de esos números. Suele distinguir mejor icnotaxones parecidos.',
  'vis.none': 'Modelo de visión no cargado (se descarga una vez, {mb} MB, y queda guardado).', 'vis.ready': 'Modelo de visión: {n}.', 'vis.pending': 'Trazas sin calcular: {n}.',
  'vis.dl': 'Descargar modelo ({mb} MB)', 'vis.file': 'Cargar .onnx', 'vis.calc': 'Calcular rasgos ({n} trazas)', 'vis.loaded': 'Modelo de visión {n} cargado',
  'vis.err': 'No se pudo cargar el modelo de visión:', 'vis.progress': 'Rasgos de visión: {k} de {n}', 'vis.done': 'Rasgos calculados: {n} trazas',
  'tr.open': 'Entrenar en este ordenador…', 'tr.title': 'Entrenar U-Net en este ordenador', 'tr.core': 'Sondeo',
  'tr.web': 'El entrenamiento dentro del programa solo está en la versión de escritorio. En el navegador: Resultados → «Datos para entrenar U-Net (ZIP)» y después «sedcoretool unet train» (ver README).',
  'tr.intro': 'Entrena una U-Net con las trazas revisadas de este proyecto, usando la tarjeta gráfica de este ordenador si la hay. El modelo se carga solo en Detección al terminar.',
  'tr.module': 'Módulo de entrenamiento', 'tr.noModule': 'Falta el módulo de entrenamiento (Python {v} encontrado). Se instala una vez (PyTorch y SedCoreTool, 2–3 GB, necesita internet).',
  'tr.install': 'Instalar módulo', 'tr.noPython': 'No se ha encontrado Python 3.10 o posterior. Instálalo desde python.org (en Windows, marca «Add python.exe to PATH») y vuelve a abrir esta ventana.',
  'tr.device': 'Listo. Se entrenará con: {n} ({d}).', 'tr.cpu': 'Sin tarjeta gráfica compatible: funcionará, pero mucho más despacio (horas).',
  'tr.data': 'Sondeos', 'tr.imgs': 'Imágenes', 'tr.traces': 'Trazas revisadas', 'tr.role': 'Uso',
  'tr.roles': '«Prueba»: no se usa para aprender; mide el resultado final en sondeos que el modelo nunca ha visto. «Validación»: decide cuándo parar. «Auto»: el programa reparte (con 3 o más sondeos reserva al menos uno de prueba y uno de validación).',
  'tr.r.auto': 'Auto', 'tr.r.val': 'Validación', 'tr.r.test': 'Prueba', 'tr.train': 'Entrenamiento', 'tr.name': 'Nombre del modelo', 'tr.epochs': 'Épocas máximas',
  'tr.pretrained': 'Partir de una red preentrenada (recomendado; descarga 85 MB la primera vez)', 'tr.go': 'Entrenar', 'tr.resume': 'Reanudar', 'tr.cancel': 'Detener',
  'tr.prog': 'Época {e} de {n} · Dice de validación {d} · mejor {b} (época {be}) · {dev}', 'tr.test': 'Resultado en los sondeos de prueba ({c}): Dice {d}, IoU {i}',
  'tr.log': 'Registro', 'tr.models': 'Modelos entrenados', 'tr.valDice': 'Dice validación', 'tr.testDice': 'Dice prueba', 'tr.date': 'Fecha', 'tr.use': 'Usar',
  'tr.noModels': 'Todavía no hay modelos.', 'tr.folder': 'Abrir carpeta de modelos', 'tr.cancelled': 'Detenido. Puedes reanudarlo con el mismo nombre.', 'tr.noResume': 'No hay un entrenamiento interrumpido con ese nombre.',
  'tr.explain': 'Dice: 0 = nada coincide, 1 = igual que tu máscara. Lo que vale para publicar es el Dice de prueba, en sondeos que el modelo no ha visto.',
  'd.unet': 'U-Net (modelo entrenado)', 'd.pThr': 'Probabilidad mínima', 'u.load': 'Cargar modelo (.onnx y .json)',
  'u.noModel': 'Sin modelo U-Net cargado.', 'u.model': 'Modelo: {n} · clases: {c} · px/cm de entrenamiento: {p}', 'u.needOnnx': 'Elige el archivo .onnx del modelo (y su .json).',
  'u.loaded': 'Modelo {n} cargado', 'u.loadErr': 'No se pudo cargar el modelo:', 'u.progress': 'U-Net: tesela {k} de {n}',
  'u.doubt': 'Mostrar zonas dudosas (probabilidad 0,3–0,7)', 'u.note': 'Usa la imagen original (sin realce). La imagen se reescala a la resolución de entrenamiento. Cambiar la probabilidad mínima no vuelve a ejecutar la red.',
  'r.train': 'Datos para entrenar U-Net (ZIP)', 'r.trainTip': 'Imágenes originales y máscaras de las trazas revisadas de todo el proyecto, para «sedcoretool unet prepare»', 'u.noReviewed': 'No hay trazas revisadas para exportar.',
  'd.kmeans': 'K-medias, 2 clases (como ICY; Miguez-Salas et al., 2019)', 'd.fill': 'Rellenar huecos dentro de las trazas',
  'bk.title': 'Copias de seguridad', 'bk.none': 'Sin copia automática en carpeta.', 'bk.ok': 'Copia automática activa en {dir}. Última: {when}.',
  'bk.needs': 'La copia automática en {dir} necesita permiso otra vez (el navegador lo pide en cada sesión).', 'bk.error': 'Error en la última copia en {dir}. Última correcta: {when}.',
  'bk.persistOn': 'El navegador ha marcado los datos de SedCoreTool como persistentes: no los borrará para liberar espacio.',
  'bk.persistOff': 'El navegador no ha confirmado el almacenamiento persistente: podría borrar los datos si falta espacio. Usa la copia en carpeta.',
  'bk.choose': 'Elegir carpeta de copia automática…', 'bk.reactivate': 'Reactivar copia automática', 'bk.full': 'Descargar copia completa (todos los proyectos)',
  'bk.failure': '{status} Motivo: {e}',
  'ip.visibleSea': 'Cubrir el mar visible (IDW)',
  'event.title': 'Sombreado de eventos en los proxies', 'event.enable': 'Sombrear las curvas por eventos o clasificación',
  'event.help': 'Selecciona tantas familias o clasificaciones como necesites. Cada fuente conserva su opacidad y colores en esta figura. Las fuentes se superponen en el orden de selección, detrás de las curvas; no cambian los datos ni las clases originales.',
  'event.use': 'Usar esta familia o clasificación', 'event.opacity': 'Opacidad de esta fuente (%)',
  'event.area': 'Zona de sombreado', 'event.panel': 'Fondo completo del panel', 'event.curve': 'Solo el área bajo la curva',
  'event.resetColors': 'Restaurar colores originales', 'event.empty': 'Añade familias de intervalos o calcula una clasificación en Multiproxy.',
  'ip.visibleSeaHelp': 'Activa IDW sin límite de radio y fuera del contorno de los sondeos, solo en el mar del encuadre visible. Ajusta el encuadre para abarcar la cuenca. Este encuadre no define un límite geológico de cuenca. Para volver a limitarlo, marca «Solo dentro del contorno de los sondeos».',
  'ip.extrapolated': 'Fuera del contorno de los sondeos, los valores son extrapolados.',
  'ip.needCoast': 'No se pudo cargar la costa. Se mantiene la configuración anterior; vuelve a intentarlo para cubrir solo el mar.',
  'diag.title': 'Diagnóstico temporal', 'diag.enable': 'Registrar acciones y fallos durante siete días',
  'diag.help': 'Registro local de controles usados, operaciones, errores y memoria. No incluye lo que escribes, nombres, rutas, imágenes ni contenido de proyectos. No se envía automáticamente. Puedes exportarlo tras reiniciar y detenerlo o borrarlo aquí. Se conservan hasta 4 MiB de los eventos más recientes.',
  'diag.active': 'Registro activo hasta {until}. Conservado: {kb} KiB.', 'diag.off': 'Registro desactivado. Conservado: {kb} KiB.',
  'diag.failed': 'No se pudo guardar o gestionar el registro de diagnóstico. El guardado de proyectos es independiente.',
  'diag.export': 'Exportar registro de diagnóstico…', 'diag.clear': 'Detener y borrar registro', 'diag.indicator': 'Diagnóstico activo',
  'err.missingImage': 'No se encuentra la imagen original «{name}». Recupera una copia completa del proyecto antes de exportarlo o copiarlo.',
  'bk.chooseAgain': 'Elige de nuevo la carpeta de copia automática para recuperar el acceso.',
  'bk.reactivateFailed': 'No se pudo reactivar la copia: {e} Usa «Elegir carpeta de copia automática…».',
  'bk.noFs': 'Este navegador no permite escribir en carpetas (funciona en Chrome y Edge). Descarga copias completas con regularidad.',
  'bk.help': 'Recomendado: elige una carpeta dentro de OneDrive, Google Drive o Dropbox. SedCoreTool guarda ahí cada proyecto 20 s después de cada cambio, una copia diaria en «historial» y tus ajustes. Para recuperar, usa «Importar archivo…» con esos archivos (admite varios a la vez y copias completas).',
  'f.autoG': 'Gamma automática: la mediana pasa a gris medio (límites 0,19–1, rango de Dorador et al., 2014)',
  'bk.restored': 'restaurado', 'bk.restoredN': '{p} proyectos y {s} ajustes restaurados',
});
Object.assign(D.en, {
  'f.p.dorador2014': 'Dorador et al. (2014): levels, contrast and vibrance', 'f.p.clahe2019': 'CLAHE (Miguez-Salas et al., 2019; Fiji)',
  'f.p.levels': 'Levels and contrast (generic)', 'f.builtin': 'Built-in settings', 'f.mine': 'My settings',
  'f.src.dorador2014': 'Dorador, Rodríguez-Tovar & IODP Exp. 339 (2014, Facies 60): Levels → Brightness/Contrast → Vibrance/Saturation. Automatic levels from percentiles (chosen per image in the paper); automatic gamma within the published range (0.19–1; mean 0.76); vibrance −31 and saturation −66 are the published means.',
  'f.src.clahe2019': 'Miguez-Salas, Dorador & Rodríguez-Tovar (2019, Marine Geology 413): Fiji contrast-limited adaptive histogram equalisation (CLAHE). Fiji defaults: block 127 px, slope 3.',
  'f.src.none': '', 'f.src.levels': 'Generic starting point, no published source.', 'f.src.local': 'Generic starting point, no published source.', 'f.src.strong': 'Generic starting point, no published source.',
  'f.auto': 'Automatic levels (0.5% and 99.5% percentiles of the analysis area)', 'f.vibrance': 'Vibrance', 'f.claheBlock': 'CLAHE: block (px; 0 = off)', 'f.claheSlope': 'CLAHE: maximum slope',
  'f.saveName': 'Name to save these settings', 'f.save': 'Save settings', 'f.del': 'Delete these saved settings', 'f.applyAll': 'Apply these settings to all sections',
  'f.saved': 'Settings “{n}” saved (enhancement + detection)', 'f.appliedAll': 'Settings applied to {n} sections',
  'vis.title': 'What the classifier looks at', 'vis.f.shape': 'Shape and colour (12 descriptors)', 'vis.d.shape': 'Area, axes, elongation, verticality, compactness, colour and contrast of each trace. Fast and explainable.',
  'vis.f.vision': 'Vision model (DINOv2)', 'vis.d.vision': 'A model already trained on millions of images turns the crop of each trace into 384 numbers that summarise its shape and texture. The classifier learns from those numbers. It usually separates similar ichnotaxa better.',
  'vis.none': 'Vision model not loaded (downloaded once, {mb} MB, then kept).', 'vis.ready': 'Vision model: {n}.', 'vis.pending': 'Traces not computed: {n}.',
  'vis.dl': 'Download model ({mb} MB)', 'vis.file': 'Load .onnx', 'vis.calc': 'Compute descriptors ({n} traces)', 'vis.loaded': 'Vision model {n} loaded',
  'vis.err': 'The vision model could not be loaded:', 'vis.progress': 'Vision descriptors: {k} of {n}', 'vis.done': 'Descriptors computed: {n} traces',
  'tr.open': 'Train on this computer…', 'tr.title': 'Train a U-Net on this computer', 'tr.core': 'Core',
  'tr.web': 'Training inside the program is only available in the desktop version. In the browser: Results → “U-Net training data (ZIP)”, then “sedcoretool unet train” (see README).',
  'tr.intro': 'Trains a U-Net on the reviewed traces of this project, using this computer’s graphics card if there is one. The model is loaded in Detection when it finishes.',
  'tr.module': 'Training module', 'tr.noModule': 'The training module is missing (Python {v} found). It is installed once (PyTorch and SedCoreTool, 2–3 GB, needs internet).',
  'tr.install': 'Install module', 'tr.noPython': 'Python 3.10 or later was not found. Install it from python.org (on Windows, tick “Add python.exe to PATH”) and reopen this window.',
  'tr.device': 'Ready. Training will use: {n} ({d}).', 'tr.cpu': 'No compatible graphics card: it will work, but much more slowly (hours).',
  'tr.data': 'Cores', 'tr.imgs': 'Images', 'tr.traces': 'Reviewed traces', 'tr.role': 'Use',
  'tr.roles': '“Test”: not used for learning; measures the final result on cores the model has never seen. “Validation”: decides when to stop. “Auto”: the program splits them (with 3 or more cores it keeps at least one for test and one for validation).',
  'tr.r.auto': 'Auto', 'tr.r.val': 'Validation', 'tr.r.test': 'Test', 'tr.train': 'Training', 'tr.name': 'Model name', 'tr.epochs': 'Maximum epochs',
  'tr.pretrained': 'Start from a pre-trained network (recommended; downloads 85 MB the first time)', 'tr.go': 'Train', 'tr.resume': 'Resume', 'tr.cancel': 'Stop',
  'tr.prog': 'Epoch {e} of {n} · validation Dice {d} · best {b} (epoch {be}) · {dev}', 'tr.test': 'Result on the test cores ({c}): Dice {d}, IoU {i}',
  'tr.log': 'Log', 'tr.models': 'Trained models', 'tr.valDice': 'Validation Dice', 'tr.testDice': 'Test Dice', 'tr.date': 'Date', 'tr.use': 'Use',
  'tr.noModels': 'No models yet.', 'tr.folder': 'Open models folder', 'tr.cancelled': 'Stopped. You can resume it with the same name.', 'tr.noResume': 'There is no interrupted training with that name.',
  'tr.explain': 'Dice: 0 = nothing matches, 1 = same as your mask. What counts for publication is the test Dice, on cores the model has not seen.',
  'd.unet': 'U-Net (trained model)', 'd.pThr': 'Minimum probability', 'u.load': 'Load model (.onnx and .json)',
  'u.noModel': 'No U-Net model loaded.', 'u.model': 'Model: {n} · classes: {c} · training px/cm: {p}', 'u.needOnnx': 'Choose the model .onnx file (and its .json).',
  'u.loaded': 'Model {n} loaded', 'u.loadErr': 'The model could not be loaded:', 'u.progress': 'U-Net: tile {k} of {n}',
  'u.doubt': 'Show doubtful zones (probability 0.3–0.7)', 'u.note': 'Uses the original image (no enhancement), rescaled to the training resolution. Changing the minimum probability does not re-run the network.',
  'r.train': 'U-Net training data (ZIP)', 'r.trainTip': 'Original images and masks of the reviewed traces of the whole project, for “sedcoretool unet prepare”', 'u.noReviewed': 'There are no reviewed traces to export.',
  'd.kmeans': 'K-means, 2 classes (as in ICY; Miguez-Salas et al., 2019)', 'd.fill': 'Fill holes inside traces',
  'bk.title': 'Backups', 'bk.none': 'No automatic folder backup.', 'bk.ok': 'Automatic backup active in {dir}. Last: {when}.',
  'bk.needs': 'The automatic backup in {dir} needs permission again (the browser asks every session).', 'bk.error': 'The last backup in {dir} failed. Last good one: {when}.',
  'bk.persistOn': 'The browser marked SedCoreTool data as persistent: it will not delete it to free space.',
  'bk.persistOff': 'The browser did not confirm persistent storage: it might delete data when space runs low. Use the folder backup.',
  'bk.choose': 'Choose automatic backup folder…', 'bk.reactivate': 'Reactivate automatic backup', 'bk.full': 'Download full backup (all projects)',
  'bk.failure': '{status} Reason: {e}',
  'ip.visibleSea': 'Cover visible sea (IDW)',
  'event.title': 'Event shading in proxy tracks', 'event.enable': 'Shade curves by events or classification',
  'event.help': 'Select as many families or classifications as needed. Each source keeps its own opacity and colours in this figure. Sources overlap in selection order, behind the curves; measurements and original classes stay unchanged.',
  'event.use': 'Use this family or classification', 'event.opacity': 'Opacity of this source (%)',
  'event.area': 'Shading area', 'event.panel': 'Whole track background', 'event.curve': 'Only the area under the curve',
  'event.resetColors': 'Restore original colours', 'event.empty': 'Add interval families or compute a classification in Multiproxy.',
  'ip.visibleSeaHelp': 'Enables IDW without a search-radius or core-outline limit, over sea within the visible map frame. Adjust the frame to include the basin. This frame does not define a geological basin boundary. To restrict it again, tick “Only inside the outline of the cores”.',
  'ip.extrapolated': 'Values outside the core outline are extrapolated.',
  'ip.needCoast': 'Could not load the coastline. Previous settings are retained; try again to cover only the sea.',
  'diag.title': 'Temporary diagnostics', 'diag.enable': 'Record actions and failures for seven days',
  'diag.help': 'Local log of controls used, operations, errors and memory. Excludes what you type, names, paths, images and project contents. Nothing is sent automatically. You can export it after restarting and stop or clear it here. Keeps up to 4 MiB of the most recent events.',
  'diag.active': 'Recording until {until}. Retained: {kb} KiB.', 'diag.off': 'Recording disabled. Retained: {kb} KiB.',
  'diag.failed': 'Could not write or manage the diagnostic log. Project saving is independent.',
  'diag.export': 'Export diagnostic log…', 'diag.clear': 'Stop and delete log', 'diag.indicator': 'Diagnostics active',
  'err.missingImage': 'Original image “{name}” is missing. Recover a complete project copy before exporting or backing it up.',
  'bk.chooseAgain': 'Choose the automatic backup folder again to restore access.',
  'bk.reactivateFailed': 'Could not reactivate the backup: {e} Use “Choose automatic backup folder…”.',
  'bk.noFs': 'This browser cannot write to folders (it works in Chrome and Edge). Download full backups regularly.',
  'bk.help': 'Recommended: choose a folder inside OneDrive, Google Drive or Dropbox. SedCoreTool saves each project there 20 s after every change, a daily copy in “historial” and your settings. To recover, use “Import file…” with those files (several at once and full backups are accepted).',
  'f.autoG': 'Automatic gamma: median to mid-grey (limits 0.19–1, range of Dorador et al., 2014)',
  'bk.restored': 'restored', 'bk.restoredN': '{p} projects and {s} settings restored',
});

// V9: geochemistry tool
Object.assign(D.es, {
  'mode.geo': 'Geoquímica',
  'geo.l.lowox': 'Baja oxigenación', 'geo.l.detrital': 'Aporte detrítico', 'geo.l.current': 'Corriente de fondo intensa', 'geo.l.background': 'Fondo / sin evento',
  'geo.s1': 'Sondeos y datos', 'geo.s2': 'Preparación', 'geo.s3': 'Etiquetas y reglas', 'geo.s4': 'Aprendizaje automático',
  'geo.impLong': 'Importar tabla larga (muchos sondeos)', 'geo.impCores': 'Importar un archivo por sondeo', 'geo.impCat': 'Importar catálogo (lat, lon)',
  'geo.includeMain': 'Añadir el sondeo de las imágenes', 'geo.demo': 'Datos de demostración (sintéticos)',
  'geo.impNote': 'CSV, TXT o Excel. Tabla larga: una fila por muestra con columna de sondeo. Archivo por sondeo: el nombre del archivo es el sondeo. El catálogo añade la posición. «Sondeo de las imágenes» trae la bioturbación, BI, ii, % por icnotaxón y los registros externos de este proyecto como variables más.',
  'geo.noCores': 'Todavía no hay sondeos. Importa datos o carga la demostración.', 'geo.noAge': 'sin edad', 'geo.imagesCore': 'imágenes',
  'geo.p.bio': 'Bioturbación %', 'geo.noImages': 'Este proyecto no tiene secciones de imagen.',
  'geo.step': 'Paso de remuestreo', 'geo.scaling': 'Escalado', 'geo.sc.global': 'z-score global', 'geo.sc.core': 'z-score por sondeo', 'geo.sc.none': 'Sin escalar',
  'geo.maxGap': 'Hueco máximo (vacío = sin límite)',
  'geo.prepNote': 'Cada sondeo se remuestrea a una malla común (interpolación lineal, sin extrapolar). «log» aplica log10 antes de escalar (útil para razones y concentraciones). El z-score por sondeo elimina diferencias de nivel entre sondeos; el global las conserva.',
  'geo.features': 'Variables (proxies) usadas', 'geo.ratio': 'Crear razón A/B',
  'geo.newLabel': 'Nueva etiqueta (p. ej. Turbidita)', 'geo.addLabel': 'Añadir etiqueta',
  'geo.labelsNote': 'Clic en una etiqueta para activarla. En «Registros», marca «Marcar intervalos» y arrastra sobre el registro para asignarla.',
  'geo.rules': 'Reglas (asociaciones de proxies)', 'geo.addRule': 'Añadir regla', 'geo.useRules': 'Usar reglas para etiquetar', 'geo.addCond': '+ condición',
  'geo.noRules': 'Sin reglas.', 'geo.rulesNote': 'Una regla asigna su etiqueta cuando se cumplen todas sus condiciones. «z>» compara el z-score dentro del sondeo; «>» el valor original. Los intervalos marcados a mano tienen prioridad.',
  'geo.method': 'Método', 'geo.minProb': 'Probabilidad mínima', 'geo.seed': 'Semilla',
  'geo.minProbNote': 'Por debajo de la probabilidad mínima la muestra queda «sin clasificar» en vez de forzar una clase. La semilla hace el resultado reproducible.',
  'geo.suggest': 'Valores sugeridos', 'geo.train': 'Entrenar y clasificar',
  'geo.m.name.rf': 'Random Forest (recomendado)', 'geo.m.name.knn': 'k vecinos más cercanos', 'geo.m.name.nb': 'Bayes ingenuo gaussiano', 'geo.m.name.kmeans': 'k-medias (sin etiquetas)',
  'geo.m.rf': 'Muchos árboles de decisión que votan. Funciona bien con pocas muestras, proxies de escalas distintas y relaciones no lineales, y dice qué proxies pesan más. Buena primera opción.',
  'geo.m.knn': 'Asigna la clase de las muestras etiquetadas más parecidas. Sencillo e interpretable; sensible al escalado y lento con cientos de miles de muestras.',
  'geo.m.nb': 'Modelo probabilístico muy rápido que supone proxies independientes y distribución normal. Útil como referencia o con muy pocas etiquetas.',
  'geo.m.kmeans': 'No usa etiquetas: agrupa las muestras en k grupos parecidos para explorar. Después puedes nombrar cada grupo en «Modelo».',
  'geo.p.rf.trees': 'Número de árboles. Más = más estable y más lento. 100 suele bastar.',
  'geo.p.rf.maxDepth': 'Profundidad máxima de cada árbol. Menos = modelo más simple (evita sobreajuste).',
  'geo.p.rf.minLeaf': 'Muestras mínimas por hoja. Subirlo suaviza las fronteras entre clases.',
  'geo.p.rf.mtry': 'Proxies probados en cada división: sqrt (recomendado), log2 o todos.',
  'geo.p.rf.bins': 'Cortes candidatos por proxy (cuantiles). 32 es suficiente.',
  'geo.p.rf.bootstrap': 'Cada árbol ve una muestra con reemplazo (recomendado).',
  'geo.p.rf.balanced': 'Compensa clases raras (los eventos suelen ser menos frecuentes que el fondo).',
  'geo.p.knn.k': 'Vecinos que votan. Impar y entre 5 y 15 suele funcionar.',
  'geo.p.knn.weights': 'distance: los vecinos más cercanos pesan más; uniform: todos igual.',
  'geo.p.nb.smoothing': 'Varianza mínima añadida para estabilidad numérica.',
  'geo.p.nb.priors': 'uniform: todas las clases igual de probables a priori; empirical: según su frecuencia.',
  'geo.p.kmeans.k': 'Número de grupos.', 'geo.p.kmeans.restarts': 'Repeticiones con inicios distintos; se queda la mejor.', 'geo.p.kmeans.maxIter': 'Iteraciones máximas por repetición.',
  'geo.needLabels': 'Hacen falta muestras de al menos dos etiquetas (intervalos o reglas).',
  'geo.tab.logs': 'Registros', 'geo.tab.map': 'Mapa', 'geo.tab.model': 'Modelo',
  'geo.core': 'Sondeo', 'geo.mark': 'Marcar intervalos con la etiqueta activa', 'geo.intervals': 'Intervalos etiquetados',
  'geo.markNote': 'Con «Marcar intervalos» activo, arrastra en vertical sobre el registro.', 'geo.noIntervals': 'Sin intervalos en este sondeo.',
  'geo.noAxis': 'Este sondeo no tiene valores en el eje elegido (falta edad o modelo de edad).',
  'geo.bandLabels': 'Etiquetas', 'geo.bandPred': 'Clasificación', 'geo.bandPredShort': 'Clases geoq.',
  'geo.subtitleLogs': '{n} muestras remuestreadas cada {step}. Banda «Etiquetas»: intervalos (opaco) y reglas (claro).',
  'geo.ageFrom': 'Edad desde', 'geo.ageTo': 'hasta', 'geo.mapMode': 'Representar', 'geo.mm.class': 'Clase dominante', 'geo.mm.value': 'Valor de un proxy',
  'geo.feature': 'Proxy', 'geo.power': 'Potencia', 'geo.ref': 'Anomalía respecto a',
  'geo.mapNoAge': 'El mapa necesita edad en los sondeos.',
  'geo.mapTitleClass': 'Clase dominante, {a0}–{a1} ka', 'geo.mapTitleValue': '{f} (z-score por sondeo), {a0}–{a1} ka',
  'geo.mapSubPred': 'Clasificación automática ({m}). Tamaño del punto = fracción de muestras de esa clase.', 'geo.mapSubLabels': 'Etiquetas del usuario (sin entrenar).',
  'geo.mapSubRef': 'Diferencia frente a la ventana {r0}–{r1} ka', 'geo.mapSubZ': 'Media del z-score dentro de cada sondeo',
  'geo.mapNote': 'Interpolación IDW solo exploratoria; puntos discontinuos = sin datos en la ventana. Costa: Natural Earth (dominio público).',
  'geo.mapHelp': 'Muévete en el tiempo con ◀ ▶ (desplaza la ventana su propia anchura).',
  'geo.samples': 'muestras', 'geo.byIntervals': 'etiquetadas por intervalos', 'geo.byRules': 'etiquetadas por reglas',
  'geo.notTrained': 'Sin entrenar. Etiqueta intervalos o define reglas y pulsa «Entrenar y clasificar».', 'geo.trainedOn': 'entrenado con {n} muestras',
  'geo.cvScheme.loco': 'Validación dejando un sondeo fuera ({k} sondeos)', 'geo.cvScheme.blocks': 'Validación por {k} bloques contiguos',
  'geo.acc': 'acierto', 'geo.bacc': 'acierto equilibrado', 'geo.trueVsPred': 'real \\ predicha', 'geo.recall': 'sensibilidad',
  'geo.cvNote': 'Cada sondeo (o bloque) se predice con un modelo entrenado sin él, para no inflar el acierto por la autocorrelación de las series. Si las etiquetas vienen de reglas, el modelo reaprende esas reglas: el acierto mide coherencia, no verdad.',
  'geo.kmeansNote': 'k-medias no tiene acierto: no hay etiquetas. Pon nombre a cada grupo si reconoces su significado.', 'geo.groupName': 'nombre del grupo',
  'geo.importance': 'Importancia de cada proxy', 'geo.importanceNote': 'Reducción media de impureza de Gini (MDI). Orientativa: favorece proxies correlacionados entre sí de forma desigual.',
  'geo.predCsv': 'Exportar clasificación (CSV)',
  'geo.imp.long': 'Tabla larga', 'geo.imp.core': 'Archivos por sondeo', 'geo.imp.catalogue': 'Catálogo de sondeos',
  'geo.r.core': 'Columna de sondeo', 'geo.r.wd': 'Profundidad de agua', 'geo.r.proxies': 'Proxies a importar', 'geo.r.ok': 'Importar',
  'geo.r.note': 'Indica qué columna es cada cosa. Hace falta profundidad o edad. Los valores no numéricos se ignoran.',
  'geo.nSamples': '{n} muestras', 'geo.missing': 'le falta: {f} (no entra en el análisis hasta que las tenga o las desmarques)',
  'geo.imported': '{n} sondeos importados', 'geo.catApplied': 'Posición aplicada a {n} filas del catálogo',
  'geo.mixedImportFailed': 'No se importaron {n} sondeos ({names}): se necesita una relación edad-profundidad creciente que cubra todos los datos. Los datos existentes se conservan.',
});
Object.assign(D.en, {
  'mode.geo': 'Geochemistry',
  'geo.l.lowox': 'Low oxygenation', 'geo.l.detrital': 'Detrital input', 'geo.l.current': 'Strong bottom current', 'geo.l.background': 'Background / no event',
  'geo.s1': 'Cores and data', 'geo.s2': 'Preparation', 'geo.s3': 'Labels and rules', 'geo.s4': 'Machine learning',
  'geo.impLong': 'Import long table (many cores)', 'geo.impCores': 'Import one file per core', 'geo.impCat': 'Import catalogue (lat, lon)',
  'geo.includeMain': 'Add the image core', 'geo.demo': 'Demo data (synthetic)',
  'geo.impNote': 'CSV, TXT or Excel. Long table: one row per sample with a core column. One file per core: the file name is the core. The catalogue adds positions. “Image core” brings this project’s bioturbation, BI, ii, % per ichnotaxon and external records as extra variables.',
  'geo.noCores': 'No cores yet. Import data or load the demo.', 'geo.noAge': 'no age', 'geo.imagesCore': 'images',
  'geo.p.bio': 'Bioturbation %', 'geo.noImages': 'This project has no image sections.',
  'geo.step': 'Resampling step', 'geo.scaling': 'Scaling', 'geo.sc.global': 'global z-score', 'geo.sc.core': 'z-score per core', 'geo.sc.none': 'No scaling',
  'geo.maxGap': 'Maximum gap (empty = no limit)',
  'geo.prepNote': 'Each core is resampled to a common grid (linear interpolation, no extrapolation). “log” applies log10 before scaling (useful for ratios and concentrations). Per-core z-score removes level differences between cores; global keeps them.',
  'geo.features': 'Variables (proxies) used', 'geo.ratio': 'Create ratio A/B',
  'geo.newLabel': 'New label (e.g. Turbidite)', 'geo.addLabel': 'Add label',
  'geo.labelsNote': 'Click a label to make it active. In “Logs”, tick “Mark intervals” and drag over the log to assign it.',
  'geo.rules': 'Rules (proxy associations)', 'geo.addRule': 'Add rule', 'geo.useRules': 'Use rules for labelling', 'geo.addCond': '+ condition',
  'geo.noRules': 'No rules.', 'geo.rulesNote': 'A rule assigns its label when all its conditions hold. “z>” compares the within-core z-score; “>” the raw value. Hand-marked intervals take precedence.',
  'geo.method': 'Method', 'geo.minProb': 'Minimum probability', 'geo.seed': 'Seed',
  'geo.minProbNote': 'Below the minimum probability a sample stays “unclassified” instead of being forced into a class. The seed makes results reproducible.',
  'geo.suggest': 'Suggested values', 'geo.train': 'Train and classify',
  'geo.m.name.rf': 'Random Forest (recommended)', 'geo.m.name.knn': 'k nearest neighbours', 'geo.m.name.nb': 'Gaussian naive Bayes', 'geo.m.name.kmeans': 'k-means (no labels)',
  'geo.m.rf': 'Many decision trees that vote. Works well with few samples, proxies on different scales and non-linear relations, and reports which proxies matter most. A good first choice.',
  'geo.m.knn': 'Assigns the class of the most similar labelled samples. Simple and interpretable; sensitive to scaling and slow with hundreds of thousands of samples.',
  'geo.m.nb': 'Very fast probabilistic model assuming independent, normally distributed proxies. Useful as a baseline or with very few labels.',
  'geo.m.kmeans': 'Uses no labels: groups samples into k similar clusters for exploration. You can name each group later in “Model”.',
  'geo.p.rf.trees': 'Number of trees. More = more stable and slower. 100 is usually enough.',
  'geo.p.rf.maxDepth': 'Maximum depth of each tree. Lower = simpler model (avoids overfitting).',
  'geo.p.rf.minLeaf': 'Minimum samples per leaf. Raising it smooths class boundaries.',
  'geo.p.rf.mtry': 'Proxies tried at each split: sqrt (recommended), log2 or all.',
  'geo.p.rf.bins': 'Candidate cuts per proxy (quantiles). 32 is enough.',
  'geo.p.rf.bootstrap': 'Each tree sees a sample drawn with replacement (recommended).',
  'geo.p.rf.balanced': 'Compensates rare classes (events are usually rarer than background).',
  'geo.p.knn.k': 'Voting neighbours. Odd and between 5 and 15 usually works.',
  'geo.p.knn.weights': 'distance: closer neighbours weigh more; uniform: all equal.',
  'geo.p.nb.smoothing': 'Minimum variance added for numerical stability.',
  'geo.p.nb.priors': 'uniform: all classes equally likely a priori; empirical: by their frequency.',
  'geo.p.kmeans.k': 'Number of groups.', 'geo.p.kmeans.restarts': 'Repeats with different starts; the best is kept.', 'geo.p.kmeans.maxIter': 'Maximum iterations per repeat.',
  'geo.needLabels': 'Samples of at least two labels are needed (intervals or rules).',
  'geo.tab.logs': 'Logs', 'geo.tab.map': 'Map', 'geo.tab.model': 'Model',
  'geo.core': 'Core', 'geo.mark': 'Mark intervals with the active label', 'geo.intervals': 'Labelled intervals',
  'geo.markNote': 'With “Mark intervals” on, drag vertically over the log.', 'geo.noIntervals': 'No intervals in this core.',
  'geo.noAxis': 'This core has no values on the chosen axis (age or age model missing).',
  'geo.bandLabels': 'Labels', 'geo.bandPred': 'Classification', 'geo.bandPredShort': 'Geochem.',
  'geo.subtitleLogs': '{n} samples resampled every {step}. “Labels” band: intervals (solid) and rules (light).',
  'geo.ageFrom': 'Age from', 'geo.ageTo': 'to', 'geo.mapMode': 'Show', 'geo.mm.class': 'Dominant class', 'geo.mm.value': 'Value of a proxy',
  'geo.feature': 'Proxy', 'geo.power': 'Power', 'geo.ref': 'Anomaly relative to',
  'geo.mapNoAge': 'The map needs ages in the cores.',
  'geo.mapTitleClass': 'Dominant class, {a0}–{a1} ka', 'geo.mapTitleValue': '{f} (per-core z-score), {a0}–{a1} ka',
  'geo.mapSubPred': 'Automatic classification ({m}). Point size = fraction of samples in that class.', 'geo.mapSubLabels': 'User labels (not trained).',
  'geo.mapSubRef': 'Difference from the {r0}–{r1} ka window', 'geo.mapSubZ': 'Mean within-core z-score',
  'geo.mapNote': 'IDW interpolation is exploratory only; dashed points = no data in the window. Coastline: Natural Earth (public domain).',
  'geo.mapHelp': 'Move through time with ◀ ▶ (shifts the window by its own width).',
  'geo.samples': 'samples', 'geo.byIntervals': 'labelled by intervals', 'geo.byRules': 'labelled by rules',
  'geo.notTrained': 'Not trained. Label intervals or define rules and press “Train and classify”.', 'geo.trainedOn': 'trained on {n} samples',
  'geo.cvScheme.loco': 'Leave-one-core-out validation ({k} cores)', 'geo.cvScheme.blocks': 'Validation by {k} contiguous blocks',
  'geo.acc': 'accuracy', 'geo.bacc': 'balanced accuracy', 'geo.trueVsPred': 'true \\ predicted', 'geo.recall': 'recall',
  'geo.cvNote': 'Each core (or block) is predicted by a model trained without it, so series autocorrelation does not inflate accuracy. If labels come from rules, the model relearns those rules: accuracy measures consistency, not truth.',
  'geo.kmeansNote': 'k-means has no accuracy: there are no labels. Name each group if you recognise its meaning.', 'geo.groupName': 'group name',
  'geo.importance': 'Importance of each proxy', 'geo.importanceNote': 'Mean decrease in Gini impurity (MDI). Indicative: it splits credit unevenly between correlated proxies.',
  'geo.predCsv': 'Export classification (CSV)',
  'geo.imp.long': 'Long table', 'geo.imp.core': 'Files per core', 'geo.imp.catalogue': 'Core catalogue',
  'geo.r.core': 'Core column', 'geo.r.wd': 'Water depth', 'geo.r.proxies': 'Proxies to import', 'geo.r.ok': 'Import',
  'geo.r.note': 'Say which column is which. Depth or age is required. Non-numeric values are ignored.',
  'geo.nSamples': '{n} samples', 'geo.missing': 'missing: {f} (left out of the analysis until it has them or you untick them)',
  'geo.imported': '{n} cores imported', 'geo.catApplied': 'Position applied to {n} catalogue rows',
  'geo.mixedImportFailed': '{n} cores not imported ({names}): a strictly increasing depth–age relation covering all data is required. Existing data are preserved.',
});

// V10: multiproxy tool (numeric records + interval layers), replaces the "geochemistry" wording
Object.assign(D.es, {
  'mode.geo': 'Multiproxy',
  'geo.s1': 'Sondeos y datos', 'geo.s2': 'Variables numéricas', 'geo.s3': 'Capas de intervalos y etiquetas', 'geo.s4': 'Clasificación automática de intervalos',
  'geo.impLong': 'Registros numéricos: tabla larga (muchos sondeos)', 'geo.impCores': 'Registros numéricos: un archivo por sondeo', 'geo.impIv': 'Intervalos descritos (litología, turbiditas…)',
  'geo.impNote': 'Cualquier registro numérico (geoquímica, foraminíferos, TOC, granulometría, color…) y cualquier intervalo descrito (litología, turbiditas, zonas de migración de metales…), en CSV, TXT o Excel. «Sondeo de las imágenes» trae la bioturbación, BI, ii, % por icnotaxón y los registros externos de este proyecto.',
  'geo.prepNote': 'Cada sondeo se remuestrea a una malla común (interpolación lineal, sin extrapolar). «log» aplica log10 antes de escalar. El z-score por sondeo elimina diferencias de nivel entre sondeos; el global las conserva. Las capas de intervalos se añaden como variables 0/1 (paso 4).',
  'geo.features': 'Variables numéricas usadas', 'geo.vars': 'variables', 'geo.ivs': 'intervalos', 'geo.noAxisData': 'sin datos numéricos para situar las muestras',
  'geo.layerEvents': 'Eventos', 'geo.layer': 'Capa', 'geo.layerDel': 'Borrar la capa y sus intervalos', 'geo.layerName': 'Nombre de la capa', 'geo.layerParent': 'Subdivisión de',
  'geo.noParent': '— (capa principal)', 'geo.newLayer': 'Nueva capa (p. ej. Litología)', 'geo.addLayer': 'Añadir capa', 'geo.newLayerChild': 'Crearla como subdivisión de la capa actual',
  'geo.cats': 'Categorías de la capa', 'geo.newLabel': 'Nueva categoría (p. ej. Turbidita)', 'geo.addLabel': 'Añadir categoría',
  'geo.labelsNote': 'Cada capa es un tipo de intervalo (eventos, litología, turbiditas, zonas de migración de metales…) con sus categorías. Una capa puede ser subdivisión de otra: sus intervalos van dentro de los de la capa madre. Clic en una categoría para activarla y, en «Registros», marca «Marcar intervalos» y arrastra.',
  'geo.rulesNote': 'Las reglas pertenecen a la capa actual y asignan su categoría cuando se cumplen todas las condiciones. Pueden usar variables numéricas («z>» = z-score dentro del sondeo; «>» = valor original) y las variables 0/1 de otras capas (p. ej. «Litología: Arcilla > 0,5»). Los intervalos marcados a mano tienen prioridad.',
  'geo.notIchno': 'Este clasificador de intervalos es independiente del que sugiere icnotaxones en el modo Sección.',
  'geo.target': 'Qué clasificar (capa objetivo)', 'geo.useLayers': 'Capas de intervalos usadas como variables',
  'geo.noSamples': 'No hay muestras: elige variables y comprueba que los sondeos tienen profundidad o edad.',
  'geo.mark': 'Marcar intervalos', 'geo.markNote': 'Con «Marcar intervalos» activo, arrastra en vertical sobre el registro: se crea un intervalo de la categoría activa. En una capa subdividida, el intervalo se ajusta al intervalo madre donde empieza. Los valores de la lista se pueden editar.',
  'geo.noCat': 'Elige una categoría en el paso 3.', 'geo.orphan': 'No está dentro de ningún intervalo de «{p}»',
  'geo.accept': 'Aceptar la clasificación como intervalos', 'geo.clearAuto': 'Quitar intervalos automáticos', 'geo.ivCsv': 'Exportar intervalos (CSV)',
  'geo.confirmAuto': 'Confirmar: pasa a ser un intervalo del usuario (cuenta para entrenar)', 'geo.accepted': '{n} intervalos automáticos creados (en cursiva; no cuentan para entrenar hasta que los confirmes con ✓)',
  'geo.bandPredShort': 'Clasif. auto',
  'geo.subtitleLogs': '{n} muestras remuestreadas cada {step}. Bandas: una por capa de intervalos (claro = regla o automático) y la clasificación automática.',
  'geo.mapTitleClass': 'Clase dominante ({l}), {a0}–{a1} ka', 'geo.mapTitleValue': '{f}, {a0}–{a1} ka',
  'geo.modelIntro': 'Capa objetivo: «{l}». Variables: {v} numéricas y {c} de capas de intervalos (0/1).',
  'geo.retrain': 'Han cambiado las variables, el eje, el escalado o la capa objetivo: vuelve a entrenar.',
  'geo.missing': 'le falta: {f} (no aporta muestras hasta que las tenga o las desmarques)',
  'geo.imp.intervals': 'Intervalos descritos', 'geo.r.from': 'Techo (desde)', 'geo.r.to': 'Base (hasta)', 'geo.r.ivAxis': 'Techo y base en', 'geo.r.layerCol': 'Columna de capa (opcional)',
  'geo.r.defCore': 'Sondeo, si no hay columna de sondeo', 'geo.r.byFile': '(el nombre de cada archivo)', 'geo.r.vals': 'Columnas con categorías',
  'geo.r.valWide': 'Cada columna marcada es una capa (p. ej. «Litología», «Turbidita»); el texto de cada fila es la categoría.',
  'geo.r.valLong': 'Formato largo: la columna de capa dice la capa de cada fila y la primera columna marcada su categoría.',
  'geo.r.noteIv': 'Una fila por intervalo, con techo y base en las mismas unidades que los registros del sondeo. Se crean las capas, categorías y sondeos que no existan. Luego puedes indicar qué capa es subdivisión de otra.',
  'geo.r.noIv': 'No se ha encontrado ningún intervalo válido.', 'geo.ivImported': '{n} intervalos importados ({l} capas nuevas; {o} fuera de su intervalo madre)',
  'geo.cvNote': 'Cada sondeo (o bloque) se predice con un modelo entrenado sin él, para no inflar el acierto por la autocorrelación. Si las etiquetas vienen de reglas, el modelo reaprende esas reglas: el acierto mide coherencia, no verdad. Los intervalos automáticos no se usan para entrenar.',
});
Object.assign(D.en, {
  'mode.geo': 'Multiproxy',
  'geo.s1': 'Cores and data', 'geo.s2': 'Numeric variables', 'geo.s3': 'Interval layers and labels', 'geo.s4': 'Automatic interval classification',
  'geo.impLong': 'Numeric records: long table (many cores)', 'geo.impCores': 'Numeric records: one file per core', 'geo.impIv': 'Described intervals (lithology, turbidites…)',
  'geo.impNote': 'Any numeric record (geochemistry, foraminifera, TOC, grain size, colour…) and any described interval (lithology, turbidites, metal migration zones…), as CSV, TXT or Excel. “Image core” brings this project’s bioturbation, BI, ii, % per ichnotaxon and external records.',
  'geo.prepNote': 'Each core is resampled to a common grid (linear interpolation, no extrapolation). “log” applies log10 before scaling. Per-core z-score removes level differences between cores; global keeps them. Interval layers are added as 0/1 variables (step 4).',
  'geo.features': 'Numeric variables used', 'geo.vars': 'variables', 'geo.ivs': 'intervals', 'geo.noAxisData': 'no numeric data to place samples',
  'geo.layerEvents': 'Events', 'geo.layer': 'Layer', 'geo.layerDel': 'Delete the layer and its intervals', 'geo.layerName': 'Layer name', 'geo.layerParent': 'Subdivision of',
  'geo.noParent': '— (main layer)', 'geo.newLayer': 'New layer (e.g. Lithology)', 'geo.addLayer': 'Add layer', 'geo.newLayerChild': 'Create it as a subdivision of the current layer',
  'geo.cats': 'Layer categories', 'geo.newLabel': 'New category (e.g. Turbidite)', 'geo.addLabel': 'Add category',
  'geo.labelsNote': 'Each layer is a type of interval (events, lithology, turbidites, metal migration zones…) with its categories. A layer can subdivide another: its intervals sit inside those of the parent layer. Click a category to make it active, then in “Logs” tick “Mark intervals” and drag.',
  'geo.rulesNote': 'Rules belong to the current layer and assign their category when all conditions hold. They can use numeric variables (“z>” = within-core z-score; “>” = raw value) and the 0/1 variables of other layers (e.g. “Lithology: Clay > 0.5”). Hand-marked intervals take precedence.',
  'geo.notIchno': 'This interval classifier is independent of the ichnotaxon suggestions in Section mode.',
  'geo.target': 'What to classify (target layer)', 'geo.useLayers': 'Interval layers used as variables',
  'geo.noSamples': 'No samples: choose variables and check that the cores have depth or age.',
  'geo.mark': 'Mark intervals', 'geo.markNote': 'With “Mark intervals” on, drag vertically over the log to create an interval of the active category. In a subdivided layer the interval is clipped to the parent interval where it starts. Values in the list can be edited.',
  'geo.noCat': 'Choose a category in step 3.', 'geo.orphan': 'Not inside any “{p}” interval',
  'geo.accept': 'Accept classification as intervals', 'geo.clearAuto': 'Remove automatic intervals', 'geo.ivCsv': 'Export intervals (CSV)',
  'geo.confirmAuto': 'Confirm: becomes a user interval (used for training)', 'geo.accepted': '{n} automatic intervals created (italic; not used for training until confirmed with ✓)',
  'geo.bandPredShort': 'Auto class',
  'geo.subtitleLogs': '{n} samples resampled every {step}. Bands: one per interval layer (light = rule or automatic) and the automatic classification.',
  'geo.mapTitleClass': 'Dominant class ({l}), {a0}–{a1} ka', 'geo.mapTitleValue': '{f}, {a0}–{a1} ka',
  'geo.modelIntro': 'Target layer: “{l}”. Variables: {v} numeric and {c} from interval layers (0/1).',
  'geo.retrain': 'Variables, axis, scaling or target layer changed: train again.',
  'geo.missing': 'missing: {f} (contributes no samples until it has them or you untick them)',
  'geo.imp.intervals': 'Described intervals', 'geo.r.from': 'Top (from)', 'geo.r.to': 'Base (to)', 'geo.r.ivAxis': 'Top and base in', 'geo.r.layerCol': 'Layer column (optional)',
  'geo.r.defCore': 'Core, if there is no core column', 'geo.r.byFile': '(each file name)', 'geo.r.vals': 'Category columns',
  'geo.r.valWide': 'Each ticked column is a layer (e.g. “Lithology”, “Turbidite”); the text in each row is the category.',
  'geo.r.valLong': 'Long format: the layer column gives each row’s layer and the first ticked column its category.',
  'geo.r.noteIv': 'One row per interval, top and base in the same units as the core’s records. Missing layers, categories and cores are created. You can then set which layer subdivides another.',
  'geo.r.noIv': 'No valid interval found.', 'geo.ivImported': '{n} intervals imported ({l} new layers; {o} outside their parent interval)',
  'geo.cvNote': 'Each core (or block) is predicted by a model trained without it, so autocorrelation does not inflate accuracy. If labels come from rules, the model relearns those rules: accuracy measures consistency, not truth. Automatic intervals are never used for training.',
});

// V11: theme, classification test with colouring
Object.assign(D.es, {
  'top.theme': 'Modo claro / oscuro',
  'geo.test': 'Probar la autoclasificación en este sondeo', 'geo.shade': 'Colorear registros por clase',
  'geo.bandTest': 'Prueba', 'geo.bandHit': 'Acierto', 'geo.testOk': 'Prueba = etiqueta', 'geo.testBad': 'Prueba ≠ etiqueta',
  'geo.testScheme.others': 'entrenado con los otros sondeos', 'geo.testScheme.blocks': '5 bloques de este sondeo, cada uno sin verse a sí mismo',
  'geo.testRes': 'Prueba ({s}): coincide con la etiqueta en el {p} % de {n} muestras etiquetadas.', 'geo.testResNo': 'Prueba ({s}): este sondeo no tiene etiquetas con las que comparar.',
  'geo.testNoSamples': 'Este sondeo no tiene muestras con las variables elegidas.',
});
Object.assign(D.en, {
  'top.theme': 'Light / dark mode',
  'geo.test': 'Test automatic classification on this core', 'geo.shade': 'Colour records by class',
  'geo.bandTest': 'Test', 'geo.bandHit': 'Match', 'geo.testOk': 'Test = label', 'geo.testBad': 'Test ≠ label',
  'geo.testScheme.others': 'trained on the other cores', 'geo.testScheme.blocks': '5 blocks of this core, each predicted without itself',
  'geo.testRes': 'Test ({s}): matches the label in {p} % of {n} labelled samples.', 'geo.testResNo': 'Test ({s}): this core has no labels to compare with.',
  'geo.testNoSamples': 'This core has no samples with the chosen variables.',
});

// V12: multi-selection of traces
Object.assign(D.es, {
  'obj.multiN': '{n} trazas seleccionadas', 'obj.multiDetail': '{m} ya asignadas · {p} con sugerencia automática · {c} sin revisar',
  'obj.multiAssign': 'Asignar a todas', 'obj.multiAccept': 'Aceptar sus sugerencias', 'obj.multiClear': 'Quitar selección', 'obj.multiDel': 'Eliminar todas',
  'obj.multiHint': 'Varias trazas: Ctrl+clic añade o quita una; Mayús+arrastrar selecciona las que caen en el rectángulo. Las teclas 1–9 asignan la clase a todas las seleccionadas.',
  'obj.selPred': 'Seleccionar las sugeridas como «{c}»', 'obj.selCand': 'Seleccionar todas sin revisar',
  'obj.autoNext': 'Saltar a la siguiente al asignar (sin cambiar el zoom)',
});
Object.assign(D.en, {
  'obj.multiN': '{n} traces selected', 'obj.multiDetail': '{m} already assigned · {p} with automatic suggestion · {c} unreviewed',
  'obj.multiAssign': 'Assign to all', 'obj.multiAccept': 'Accept their suggestions', 'obj.multiClear': 'Clear selection', 'obj.multiDel': 'Delete all',
  'obj.multiHint': 'Several traces: Ctrl+click adds or removes one; Shift+drag selects those inside the rectangle. Keys 1–9 assign the class to all selected.',
  'obj.selPred': 'Select those suggested as “{c}”', 'obj.selCand': 'Select all unreviewed',
  'obj.autoNext': 'Jump to the next after assigning (zoom unchanged)',
});

// V12: missing values, how-to of the multiproxy mode
Object.assign(D.es, {
  'geo.missingSel': 'Variables que faltan en un sondeo', 'geo.miss.drop': 'La muestra no entra (más estricto)', 'geo.miss.mean': 'Rellenar con la media (permite sondeos con variables distintas)',
  'geo.missingMean': 'sin {f} (se rellena con la media)',
  'geo.howtoTitle': '¿Cómo funciona este modo?',
  'geo.howto': '<ol style="margin:0;padding-left:18px;display:grid;gap:4px"><li><b>Sondeos y datos.</b> Cada sondeo tiene registros numéricos (geoquímica, foraminíferos, TOC, bioturbación…) en profundidad o en edad, y su posición.</li><li><b>Variables.</b> Eliges qué registros se usan. Todos se pasan a una malla común (por ejemplo cada 0,5 ka) para poder compararlos.</li><li><b>Intervalos.</b> Son tus interpretaciones: litología, ORL, sapropeles, estadiales, turbiditas… Se organizan en capas, y una capa puede subdividir a otra. Puedes importarlos, dibujarlos sobre el registro y editarlos.</li><li><b>Clasificación automática.</b> Eliges qué capa quieres que aprenda (por ejemplo «Capas orgánicas»). El programa aprende qué combinación de variables y de otras capas corresponde a cada categoría en los sondeos que ya has interpretado, y propone esa interpretación en los demás o en las partes sin interpretar.</li><li><b>Comprobar.</b> «Probar la autoclasificación» predice un sondeo sin usar sus propias etiquetas y colorea aciertos y fallos. La pestaña Modelo da la validación dejando un sondeo fuera y qué variables pesan más; Mapa muestra el resultado por ventana de edad.</li></ol><p class="note">Es independiente del reconocimiento de icnotaxones del modo Sección.</p>',
});
Object.assign(D.en, {
  'geo.missingSel': 'Variables missing in a core', 'geo.miss.drop': 'The sample is left out (stricter)', 'geo.miss.mean': 'Fill with the mean (allows cores with different variables)',
  'geo.missingMean': 'no {f} (filled with the mean)',
  'geo.howtoTitle': 'How does this mode work?',
  'geo.howto': '<ol style="margin:0;padding-left:18px;display:grid;gap:4px"><li><b>Cores and data.</b> Each core has numeric records (geochemistry, foraminifera, TOC, bioturbation…) in depth or age, and its position.</li><li><b>Variables.</b> Choose which records are used. All are resampled to a common grid (e.g. every 0.5 ka) so they can be compared.</li><li><b>Intervals.</b> Your interpretations: lithology, ORLs, sapropels, stadials, turbidites… organised in layers; a layer can subdivide another. Import, draw and edit them.</li><li><b>Automatic classification.</b> Choose the layer to learn (e.g. “Organic layers”). The program learns which combination of variables and other layers matches each category in the cores you have interpreted, and proposes it for the others or for uninterpreted parts.</li><li><b>Check.</b> “Test automatic classification” predicts a core without its own labels and colours matches and errors. The Model tab gives leave-one-core-out validation and which variables matter; Map shows results by age window.</li></ol><p class="note">Independent of the ichnotaxon recognition of Section mode.</p>',
});

// V12: preset ranking by separability
Object.assign(D.es, { 'f.best': 'Elegir el ajuste que más separa trazas y matriz', 'f.rank': 'Separabilidad η (Otsu, 0–1): {list}. Es una ayuda para empezar: revisa el resultado a ojo.' });
Object.assign(D.en, { 'f.best': 'Pick the setting that best separates traces and matrix', 'f.rank': 'Separability η (Otsu, 0–1): {list}. A starting point: check the result by eye.' });

// V13: box selection by dragging, rectangular exclusion
Object.assign(D.es, { 'tool.shape': 'Forma', 'tool.shapeBrush': 'Pincel', 'tool.shapeRect': 'Rectángulo',
  'obj.multiHint': 'Varias trazas: arrastra un recuadro con la herramienta de selección; Mayús o Ctrl + clic añade o quita una; Mayús o Ctrl + recuadro añade a la selección. Las teclas 1–9 asignan la clase a todas. Para moverte: herramienta mano, barra espaciadora o botón central.' });
Object.assign(D.en, { 'tool.shape': 'Shape', 'tool.shapeBrush': 'Brush', 'tool.shapeRect': 'Rectangle',
  'obj.multiHint': 'Several traces: drag a box with the selection tool; Shift or Ctrl + click adds or removes one; Shift or Ctrl + box adds to the selection. Keys 1–9 assign the class to all. To move: hand tool, space bar or middle button.' });

// V14: projects → cores, home, data tab, windows
Object.assign(D.es, {
  'mode.section': 'Bioturbación', 'mode.log': 'Registro', 'mode.data': 'Datos', 'mode.geo': 'Multiproxy',
  'core.label': 'Sondeo', 'core.add': 'Añadir sondeo', 'core.edit': 'Editar sondeo', 'core.del': 'Eliminar sondeo', 'core.first': 'Sondeo 1', 'core.new': 'Sondeo nuevo',
  'core.name': 'Nombre', 'core.units': 'Unidades de profundidad', 'core.notes': 'Notas',
  'core.note': 'Cada sondeo guarda sus imágenes (bioturbación), sus datos importados, sus registros, su modelo de edad y sus intervalos.',
  'home.title': 'Proyectos', 'home.back': 'Volver al proyecto abierto', 'home.all': 'Todos los proyectos', 'home.cores': '{n} sondeos',
  'home.allNote': 'Sondeos de todos los proyectos: tabla con sus datos (clic para abrir) y mapa multiproyecto por ventana de edad.',
  'home.mmLayer': 'Categoría dominante de una capa', 'home.mmSites': 'Situación de los sondeos', 'home.project': 'Proyecto', 'home.nVars': 'Variables', 'home.images': 'Imágenes',
  'home.noSites': 'Ningún sondeo tiene latitud y longitud.', 'home.mapSites': 'Sondeos por proyecto', 'home.mapValue': '{f} (z-score en cada sondeo), {a0}–{a1} ka',
  'home.mapLayer': '{l}: categoría dominante, {a0}–{a1} ka', 'home.mapSub': '{n} proyectos. Valores calculados sobre los datos guardados de cada proyecto.',
  'data.core': 'Sondeo', 'data.view': 'Vista', 'data.table': 'Tabla de datos', 'data.cols': 'Columnas calculadas y manuales', 'data.cells': 'Hoja libre (celdas)',
  'data.showLayers': 'Mostrar intervalos', 'data.csv': 'Exportar CSV', 'data.allCores': 'Todos los sondeos', 'data.info': '{r} filas · {c} columnas',
  'data.src.imp': 'importado', 'data.src.rec': 'registro', 'data.src.img': 'creado (imágenes)', 'data.src.man': 'creado (manual)', 'data.src.calc': 'calculado', 'data.src.lay': 'intervalo',
  'data.more': 'Mostrar {n} filas más',
  'data.note': 'Importado = archivos de datos y registros externos; creado = bioturbación de las imágenes y columnas escritas a mano (editables aquí); calculado = fórmulas. Cada fila es una profundidad (o edad) con dato en alguna columna.',
  'data.calcTitle': 'Columnas calculadas', 'data.calcHelp': 'Fórmula sobre las columnas del sondeo: nombres con espacios o símbolos entre corchetes, p. ej. [XRF Ba/Ti] / TOC_pct, log10([Bioturbación %]), zscore(x), movavg(x, 5). Funciones: {f}. También depth y age. Se recalculan solas y aparecen como variables en Multiproxy.',
  'data.newName': 'Nombre de la columna', 'data.addCalc': 'Añadir columna calculada', 'data.manTitle': 'Columnas manuales',
  'data.manHelp': 'Columna vacía en las profundidades del sondeo para escribir valores a mano en la tabla.', 'data.addMan': 'Añadir columna manual',
  'data.cellsInfo': 'Hoja libre del proyecto',
  'data.cellsHelp': 'Como una hoja de cálculo: número, texto o fórmula que empieza por =. Referencias A1, rangos A1:B5, SUM, MEAN, MIN, MAX, COUNT, STD, MEDIAN, CORR. COL("columna") toma una columna del sondeo activo y COL("columna"; "sondeo") de otro, p. ej. =MEAN(COL("TOC_pct")) o =CORR(COL("Ba/Al"), COL("TOC_pct")).',
  'win.new': 'Abrir en ventana nueva', 'win.panel': 'Abrir en panel flotante', 'win.title.map': 'Mapa', 'win.title.corelog': 'Registro del sondeo', 'win.title.geologs': 'Registros multiproxy',
  'win.fileNote': 'Archivo local: si la ventana nueva no se actualiza, usa el panel flotante.',
});
Object.assign(D.en, {
  'mode.section': 'Bioturbation', 'mode.log': 'Core log', 'mode.data': 'Data', 'mode.geo': 'Multiproxy',
  'core.label': 'Core', 'core.add': 'Add core', 'core.edit': 'Edit core', 'core.del': 'Delete core', 'core.first': 'Core 1', 'core.new': 'New core',
  'core.name': 'Name', 'core.units': 'Depth units', 'core.notes': 'Notes',
  'core.note': 'Each core keeps its images (bioturbation), imported data, records, age model and intervals.',
  'home.title': 'Projects', 'home.back': 'Back to the open project', 'home.all': 'All projects', 'home.cores': '{n} cores',
  'home.allNote': 'Cores of every project: table of their data (click to open) and multiproject map by age window.',
  'home.mmLayer': 'Dominant category of a layer', 'home.mmSites': 'Core locations', 'home.project': 'Project', 'home.nVars': 'Variables', 'home.images': 'Images',
  'home.noSites': 'No core has latitude and longitude.', 'home.mapSites': 'Cores by project', 'home.mapValue': '{f} (z-score within each core), {a0}–{a1} ka',
  'home.mapLayer': '{l}: dominant category, {a0}–{a1} ka', 'home.mapSub': '{n} projects. Values computed from the saved data of each project.',
  'data.core': 'Core', 'data.view': 'View', 'data.table': 'Data table', 'data.cols': 'Computed and manual columns', 'data.cells': 'Free sheet (cells)',
  'data.showLayers': 'Show intervals', 'data.csv': 'Export CSV', 'data.allCores': 'All cores', 'data.info': '{r} rows · {c} columns',
  'data.src.imp': 'imported', 'data.src.rec': 'record', 'data.src.img': 'created (images)', 'data.src.man': 'created (manual)', 'data.src.calc': 'computed', 'data.src.lay': 'interval',
  'data.more': 'Show {n} more rows',
  'data.note': 'Imported = data files and external records; created = bioturbation from images and hand-written columns (editable here); computed = formulas. Each row is a depth (or age) with data in some column.',
  'data.calcTitle': 'Computed columns', 'data.calcHelp': 'Formula over the core columns: names with spaces or symbols in brackets, e.g. [XRF Ba/Ti] / TOC_pct, log10(x), zscore(x), movavg(x, 5). Functions: {f}. Also depth and age. Recomputed automatically and available as variables in Multiproxy.',
  'data.newName': 'Column name', 'data.addCalc': 'Add computed column', 'data.manTitle': 'Manual columns',
  'data.manHelp': 'Empty column at the core depths to type values in the table.', 'data.addMan': 'Add manual column',
  'data.cellsInfo': 'Free sheet of the project',
  'data.cellsHelp': 'Like a spreadsheet: number, text or formula starting with =. References A1, ranges A1:B5, SUM, MEAN, MIN, MAX, COUNT, STD, MEDIAN, CORR. COL("column") takes a column of the active core and COL("column", "core") of another one.',
  'win.new': 'Open in new window', 'win.panel': 'Open in floating panel', 'win.title.map': 'Map', 'win.title.corelog': 'Core log', 'win.title.geologs': 'Multiproxy logs',
  'win.fileNote': 'Local file: if the new window does not update, use the floating panel.',
});

// V14: figures
Object.assign(D.es, {
  'mode.fig': 'Figuras', 'fig.type': 'Figura', 'fig.t.traces': 'Trazas representativas por icnotaxón', 'fig.t.core': 'Sondeo entero interpretado',
  'fig.t.log': 'Registro del sondeo (ventana actual)', 'fig.t.geolog': 'Registro multiproxy de un sondeo', 'fig.t.map': 'Mapa multiproxy',
  'fig.pngRes': 'Resolución del PNG', 'fig.pngRes0': '×2 (pantalla)', 'fig.pngTooBig': 'A {dpi} dpi la imagen tendría {w} × {h} px, más de lo que el navegador puede dibujar; elige una resolución menor.',
  'fig.title': 'Título', 'fig.caption': 'Pie de figura', 'fig.note': 'SVG para editar en Inkscape o Illustrator; PNG a doble resolución.',
  'fig.n': 'Ejemplos por icnotaxón', 'fig.pick': 'Elección automática', 'fig.pick.largest': 'Los más grandes', 'fig.pick.typical': 'Los más típicos', 'fig.pick.spread': 'Repartidos en profundidad',
  'fig.tile': 'Tamaño de cada ejemplo (px)', 'fig.outline': 'Dibujar el contorno de la traza', 'fig.auto': 'Elegir automáticamente',
  'fig.chosen': '{n} elegidos de {m}', 'fig.nOf': '{n} de {m} trazas', 'fig.noTraces': 'Este sondeo aún no tiene trazas asignadas a icnotaxones.',
  'fig.pickFirst': 'Marca los ejemplos de cada icnotaxón (o pulsa «Elegir automáticamente»).', 'fig.empty': 'No hay datos para esta figura en el sondeo o proyecto actual.',
  'fig.coreSub': 'Sondeo completo · {n} secciones', 'fig.coreNote': 'Imagen con las trazas, bioturbación, icnotaxones, índices, registros y bandas de intervalos y clasificación, de techo a muro. Las pistas visibles son las del Registro del sondeo.',
  'fig.geoNote': 'Las capas y la clasificación proceden de Multiproxy. Esta figura guarda su propio eje, tratamiento de imagen, variables, taxones y orden de columnas.', 'fig.geoReset': 'Seguir la selección de Multiproxy', 'fig.geoCompositionReset': 'Restablecer la composición de esta figura', 'fig.mapNote': 'Usa la ventana de edad y el modo elegidos en la pestaña Mapa de Multiproxy.',
  'fig.logNote': 'Usa la ventana, la altura y las pistas elegidas en Registro del sondeo.',
});
Object.assign(D.en, {
  'mode.fig': 'Figures', 'fig.type': 'Figure', 'fig.t.traces': 'Representative traces per ichnotaxon', 'fig.t.core': 'Whole interpreted core',
  'fig.t.log': 'Core log (current window)', 'fig.t.geolog': 'Multiproxy log of a core', 'fig.t.map': 'Multiproxy map',
  'fig.pngRes': 'PNG resolution', 'fig.pngRes0': '×2 (screen)', 'fig.pngTooBig': 'At {dpi} dpi the image would be {w} × {h} px, more than the browser can draw; choose a lower resolution.',
  'fig.title': 'Title', 'fig.caption': 'Caption', 'fig.note': 'SVG to edit in Inkscape or Illustrator; PNG at double resolution.',
  'fig.n': 'Examples per ichnotaxon', 'fig.pick': 'Automatic choice', 'fig.pick.largest': 'Largest', 'fig.pick.typical': 'Most typical', 'fig.pick.spread': 'Spread in depth',
  'fig.tile': 'Size of each example (px)', 'fig.outline': 'Draw the trace outline', 'fig.auto': 'Choose automatically',
  'fig.chosen': '{n} chosen of {m}', 'fig.nOf': '{n} of {m} traces', 'fig.noTraces': 'This core has no traces assigned to ichnotaxa yet.',
  'fig.pickFirst': 'Tick the examples of each ichnotaxon (or press “Choose automatically”).', 'fig.empty': 'No data for this figure in the current core or project.',
  'fig.coreSub': 'Whole core · {n} sections', 'fig.coreNote': 'Image with traces, bioturbation, ichnotaxa, indices, records and interval/classification bands, top to bottom. Tracks as in Core log.',
  'fig.geoNote': 'Layers and classification come from Multiproxy. This figure stores its own axis, image treatment, variables, taxa and column order.', 'fig.geoReset': 'Follow the Multiproxy selection', 'fig.geoCompositionReset': 'Reset this figure composition', 'fig.mapNote': 'Uses the age window and mode of the Multiproxy Map tab.',
  'fig.logNote': 'Uses the window, height and tracks of Core log.',
});

Object.assign(D.es, { 'help.structure': '<p><b>Organización.</b> ⌂ Proyectos abre la pantalla inicial: todos los proyectos, sus sondeos y un mapa multiproyecto. Cada proyecto tiene varios <b>sondeos</b> (selector «Sondeo», + para añadir, ✎ para editar posición y unidades). Cada sondeo guarda sus imágenes y su bioturbación, sus datos importados, registros, modelo de edad e intervalos. Pestañas: <b>Bioturbación</b> (imágenes), <b>Columna</b> (sondeo en profundidad o edad), <b>Datos</b> (todos los datos, columnas calculadas y hoja libre), <b>Multiproxy</b> (registros, mapa y clasificación de los sondeos del proyecto) y <b>Figuras</b>. El mapa y los registros se pueden abrir en otra ventana o en un panel flotante.</p>' });
Object.assign(D.en, { 'help.structure': '<p><b>Organisation.</b> ⌂ Projects opens the start screen: every project, its cores and a multiproject map. Each project has several <b>cores</b> (Core selector, + to add, ✎ to edit position and units). Each core keeps its images and bioturbation, imported data, records, age model and intervals. Tabs: <b>Bioturbation</b> (images), <b>Core column</b>, <b>Data</b> (all data, computed columns and free sheet), <b>Multiproxy</b> (logs, map and classification of the project cores) and <b>Figures</b>. Map and logs can open in another window or a floating panel.</p>' });

Object.assign(D.es, {
  'ms.title': 'Personalizar mapa y zoom', 'ms.bg': 'Fondo', 'ms.opacity': 'Opacidad del fondo', 'ms.coast': 'Línea de costa',
  'ms.bg.vector': 'Simple (vectorial, sin conexión)', 'ms.bg.physical': 'Mapa físico', 'ms.bg.relief': 'Relieve sombreado',
  'ms.bg.topo': 'Topográfico', 'ms.bg.bathy': 'Batimétrico', 'ms.bg.gebco': 'Batimétrico y topográfico (GEBCO)',
  'ms.bg.photo': 'Foto aérea / satélite', 'ms.bg.photobathy': 'Foto aérea y batimetría',
  'ms.symbol': 'Símbolo', 'ms.sym.circle': 'Círculo', 'ms.sym.square': 'Cuadrado', 'ms.sym.triangle': 'Triángulo', 'ms.sym.diamond': 'Rombo',
  'ms.sym.star': 'Estrella', 'ms.sym.hexagon': 'Hexágono', 'ms.sym.cross': 'Cruz',
  'ms.size': 'Tamaño', 'ms.sizeFrac': 'Tamaño según fracción', 'ms.labels': 'Etiquetas', 'ms.labelSize': 'Tamaño etiqueta', 'ms.labelValue': 'Valor en la etiqueta',
  'ms.halo': 'Halo', 'ms.labelColor': 'Color etiqueta', 'ms.pointColor': 'Color sondeos', 'ms.stroke': 'Borde', 'ms.land': 'Tierra', 'ms.sea': 'Mar',
  'ms.grat': 'Retícula', 'ms.scale': 'Escala', 'ms.north': 'Norte', 'ms.extent': 'Extensión (O S E N)', 'ms.fit': 'Ajustar a los sondeos', 'ms.reset': 'Estilo por defecto',
  'ms.zoomHelp': 'Rueda del ratón: zoom · arrastrar: mover · doble clic: acercar.', 'ms.loading': 'Cargando fondo…',
  'ms.bgFail': 'No se pudo descargar el fondo (sin conexión o bloqueado); se muestra el mapa simple.',
});
Object.assign(D.en, {
  'ms.title': 'Customise map and zoom', 'ms.bg': 'Background', 'ms.opacity': 'Background opacity', 'ms.coast': 'Coastline',
  'ms.bg.vector': 'Simple (vector, offline)', 'ms.bg.physical': 'Physical map', 'ms.bg.relief': 'Shaded relief',
  'ms.bg.topo': 'Topographic', 'ms.bg.bathy': 'Bathymetric', 'ms.bg.gebco': 'Bathymetry and topography (GEBCO)',
  'ms.bg.photo': 'Aerial / satellite photo', 'ms.bg.photobathy': 'Aerial photo and bathymetry',
  'ms.symbol': 'Symbol', 'ms.sym.circle': 'Circle', 'ms.sym.square': 'Square', 'ms.sym.triangle': 'Triangle', 'ms.sym.diamond': 'Diamond',
  'ms.sym.star': 'Star', 'ms.sym.hexagon': 'Hexagon', 'ms.sym.cross': 'Cross',
  'ms.size': 'Size', 'ms.sizeFrac': 'Size by fraction', 'ms.labels': 'Labels', 'ms.labelSize': 'Label size', 'ms.labelValue': 'Value in label',
  'ms.halo': 'Halo', 'ms.labelColor': 'Label colour', 'ms.pointColor': 'Core colour', 'ms.stroke': 'Outline', 'ms.land': 'Land', 'ms.sea': 'Sea',
  'ms.grat': 'Graticule', 'ms.scale': 'Scale bar', 'ms.north': 'North arrow', 'ms.extent': 'Extent (W S E N)', 'ms.fit': 'Fit to cores', 'ms.reset': 'Default style',
  'ms.zoomHelp': 'Mouse wheel: zoom · drag: pan · double click: zoom in.', 'ms.loading': 'Loading background…',
  'ms.bgFail': 'The background could not be downloaded (offline or blocked); showing the simple map.',
});

Object.assign(D.es, {
  'l.scope': 'Modelo que sugiere', 'l.scope.core': 'Este sondeo', 'l.scope.project': 'Proyecto', 'l.scope.all': 'Todos los proyectos',
  'obj.probs': 'Probabilidad por modelo', 'obj.novelBy': 'Distinta de todo lo visto según: {m}',
  'home.tab.projects': 'Proyectos', 'home.tab.all': 'Todos los proyectos',
  'mp.title': 'Análisis multiproyecto', 'mp.note': 'Marca sondeos de proyectos distintos y crea un análisis: es un proyecto aparte con una copia de sus datos (sin imágenes), capas e intervalos unidos por nombre, donde puedes usar Multiproxy, Datos y Figuras. «Actualizar» vuelve a copiar los datos de los proyectos de origen.',
  'mp.name': 'Nombre del análisis', 'mp.create': 'Analizar los sondeos marcados', 'mp.all': 'Marcar todos', 'mp.none': 'Ninguno', 'mp.sel': '{n} sondeos marcados',
  'mp.need': 'Marca al menos dos sondeos.', 'mp.update': 'Actualizar desde los proyectos', 'mp.badge': 'multiproyecto', 'mp.updated': 'Datos copiados de nuevo desde los proyectos de origen.',
  'mp.from': 'De «{p}»',
});
Object.assign(D.en, {
  'l.scope': 'Model that suggests', 'l.scope.core': 'This core', 'l.scope.project': 'Project', 'l.scope.all': 'All projects',
  'obj.probs': 'Probability by model', 'obj.novelBy': 'Unlike anything seen according to: {m}',
  'home.tab.projects': 'Projects', 'home.tab.all': 'All projects',
  'mp.title': 'Multiproject analysis', 'mp.note': 'Tick cores of different projects and create an analysis: a separate project with a copy of their data (no images), layers and intervals merged by name, where Multiproxy, Data and Figures work. “Update” copies the data from the source projects again.',
  'mp.name': 'Analysis name', 'mp.create': 'Analyse the ticked cores', 'mp.all': 'Tick all', 'mp.none': 'None', 'mp.sel': '{n} cores ticked',
  'mp.need': 'Tick at least two cores.', 'mp.update': 'Update from the projects', 'mp.badge': 'multiproject', 'mp.updated': 'Data copied again from the source projects.',
  'mp.from': 'From “{p}”',
});

Object.assign(D.es, {
  'ml.open': 'Modelos y entrenamiento…', 'ml.p.method': 'Método', 'ml.title': 'Modelos y entrenamiento de icnotaxones',
  'ml.tab.guide': 'Cómo funciona', 'ml.tab.train': 'Método y evaluación', 'ml.tab.examples': 'Ejemplos usados', 'ml.tab.others': 'Ejemplos de otros proyectos',
  'ml.m.knn': 'k vecinos (k-NN)', 'ml.m.rf': 'Bosque aleatorio (Random Forest)', 'ml.m.nb': 'Bayes ingenuo (Naive Bayes)',
  'ml.d.knn': 'Busca las k trazas etiquetadas más parecidas y vota. Funciona desde 2 ejemplos, se actualiza al instante y se explica viendo los vecinos. Bueno con pocos ejemplos.',
  'ml.d.rf': 'Cientos de árboles de decisión («si es alargada y vertical…») que votan. Suele acertar más cuando hay muchos ejemplos (decenas por taxón) y descriptores que pesan distinto. Más lento.',
  'ml.d.nb': 'Supone que cada descriptor sigue una campana (normal) en cada taxón y combina las probabilidades. Muy rápido y estable con pocos ejemplos, pero simplifica (ignora que tamaño y longitud van juntos).',
  'ml.trainIntro': 'Elige el método y sus parámetros. El cambio se aplica a los tres modelos (sondeo, proyecto y todos). Para saber cuál funciona mejor con tus datos, pulsa «Evaluar y comparar».',
  'ml.p.k': 'Vecinos (k)', 'ml.p.weights': 'Peso del voto', 'ml.p.wDist': 'Más peso a los más parecidos', 'ml.p.wUni': 'Todos igual',
  'ml.p.trees': 'Árboles', 'ml.p.depth': 'Profundidad máxima', 'ml.p.leaf': 'Ejemplos mínimos por hoja', 'ml.p.balanced': 'Compensar taxones con pocos ejemplos',
  'ml.p.priors': 'Probabilidad de partida', 'ml.p.pUni': 'Igual para todos los taxones', 'ml.p.pEmp': 'Según cuántos ejemplos hay de cada uno',
  'ml.paramHelp.knn': 'k pequeño (3–5) sigue mucho a los ejemplos concretos; k grande (9–15) suaviza pero puede tragarse taxones raros. Con menos de 10 ejemplos por taxón usa k ≤ 5.',
  'ml.paramHelp.rf': 'Más árboles = más estable pero más lento (100 suele bastar). Menos profundidad y más ejemplos por hoja = menos riesgo de memorizar los ejemplos. «Compensar» evita que el taxón más abundante se lo coma todo.',
  'ml.paramHelp.nb': '«Igual para todos» no favorece al taxón más frecuente; «según ejemplos» acierta más en total pero menos en los raros.',
  'ml.noveltyHelp': 'La tolerancia a formas nuevas decide cuándo el programa dice «no se parece a nada» (más baja = más prudente).',
  'ml.eval': 'Evaluar y comparar', 'ml.evalHint': 'Prueba los 3 métodos con los 3 modelos (validación cruzada agrupada, semilla 42).',
  'ml.evalNeed': 'Hacen falta al menos 6 ejemplos de 2 taxones para evaluar.',
  'ml.evalTitle': 'Resultado de la evaluación', 'ml.onCore': 'las trazas etiquetadas de este sondeo', 'ml.onProject': 'las trazas etiquetadas del proyecto',
  'ml.evalNote': 'Se predicen {n} trazas ({w}) que el modelo no ha visto (cada traza se predice una vez, entrenando sin su grupo). Primera cifra: acierto equilibrado (media del acierto de cada taxón, no se deja engañar por un taxón muy abundante). Entre paréntesis: acierto total.',
  'ml.useBest': 'Usar esta combinación', 'ml.applied': 'Método y modelo aplicados.',
  'ml.cm': 'Matriz de confusión de la mejor combinación', 'ml.cmNote': 'Filas: taxón real; columnas: taxón predicho. La diagonal son los aciertos; fuera de ella, qué se confunde con qué.', 'ml.real': 'Real', 'ml.pred': 'Predicho',
  'ml.rec': 'Recomendación para tus datos', 'ml.recNone': 'Aún no hay trazas etiquetadas: etiqueta algunas (al menos 10 por taxón) y vuelve aquí.',
  'ml.recCounts': 'Ejemplos disponibles: {c} en este sondeo, {p} en el proyecto, {a} en todos los proyectos.',
  'ml.recFew': 'Taxones con menos de 10 ejemplos (los modelos los reconocerán mal): {l}.',
  'ml.recBest': 'Mejor combinación evaluada: modelo «{s}» con {m} — acierto equilibrado {v} %.',
  'ml.recClose': 'Otras combinaciones quedan a menos de 3 puntos; se recomienda la más sencilla (primero el método más simple, después el modelo más local).', 'ml.recEval': 'Pulsa «Evaluar y comparar» en «Método y evaluación» para saber qué combinación funciona mejor con tus datos.',
  'ml.exScope': 'Modelo', 'ml.exCount': '{n} ejemplos en uso de {t}', 'ml.exHelp': 'Cada imagen es una traza etiquetada que el modelo usa para aprender. Desmarca «usar» si no es un buen ejemplo (mal recortada, dudosa, mal etiquetada): sigue etiquetada y contando en la bioturbación, pero el modelo no aprende de ella. Clic en la imagen para ir a la traza.',
  'ml.use': 'usar', 'ml.remove': 'Quitar', 'ml.library': 'Biblioteca', 'ml.noImg': 'sin imagen', 'ml.fewWarn': 'pocos ejemplos',
  'ml.othersIntro': 'Trazas etiquetadas en otros proyectos. Marca las que quieras y añádelas a la biblioteca de este proyecto: pasan a usarse en los modelos de sondeo y de proyecto. (El modelo «todos los proyectos» ya las usa.)',
  'ml.othersNone': 'No hay trazas etiquetadas en otros proyectos (o aún no se han guardado).', 'ml.pick': 'elegir', 'ml.inLib': 'ya en la biblioteca', 'ml.addLib': 'Añadir {n} a la biblioteca', 'ml.added': '{n} ejemplos añadidos a la biblioteca.',
  'ml.guide': `<h3>¿Qué hace el programa?</h3><p>Es <b>aprendizaje supervisado</b>: tú etiquetas algunas trazas (los <b>ejemplos</b>) y el programa aprende a reconocer las demás. No mira la imagen como lo haría una persona: de cada traza mide 12 números (<b>descriptores</b>) y aprende qué combinación de números corresponde a cada icnotaxón.</p>
<table class="dtable gtab"><tbody><tr><th>Tamaño</th><td>área, longitud y anchura (en cm, escala logarítmica)</td></tr><tr><th>Forma</th><td>alargamiento, verticalidad, compacidad (1 = disco) y cuánto rellena su rectángulo</td></tr><tr><th>Relleno</th><td>brillo, textura (variación del brillo) y dos ejes de color (rojo–verde, amarillo–azul) en la imagen original</td></tr><tr><th>Contraste</th><td>diferencia de brillo con el sedimento que la rodea</td></tr></tbody></table>
<p>Por eso el programa distingue bien taxones con forma o tamaño distintos (<i>Zoophycos</i> frente a <i>Chondrites</i>) y peor los que solo se diferencian por detalles internos. Los colores dependen de la iluminación y del escáner: mezclar imágenes muy distintas empeora el aprendizaje.</p>
<h3>Los tres métodos</h3><table class="dtable gtab"><thead><tr><th></th><th>Cómo decide</th><th>Cuándo usarlo</th></tr></thead><tbody>
<tr><th>k vecinos (k-NN)</th><td>Busca las k trazas etiquetadas más parecidas y vota (las más cercanas pesan más).</td><td>Con pocos ejemplos (menos de ~20 por taxón) y para empezar. Es el método por defecto.</td></tr>
<tr><th>Bosque aleatorio</th><td>Muchos árboles de preguntas («¿alargamiento mayor que 3?») construidos con partes distintas de los ejemplos; votan.</td><td>Con bastantes ejemplos (decenas por taxón). Suele ser el más preciso, pero puede memorizar si hay pocos.</td></tr>
<tr><th>Bayes ingenuo</th><td>Calcula, para cada taxón, la probabilidad de esos descriptores suponiendo que cada uno sigue una curva normal.</td><td>Como referencia rápida o con muy pocos ejemplos. Simplifica mucho.</td></tr></tbody></table>
<p>En todos, el programa además comprueba si la traza <b>se parece a algún ejemplo</b>: si está demasiado lejos de todos, dice «no se parece a nada conocido» en vez de inventar.</p>
<h3>¿Modelo del sondeo, del proyecto o de todos?</h3><ul><li><b>Este sondeo:</b> solo aprende de las trazas de este sondeo. Mejor si el sondeo es distinto de los demás (otra litología, otro escáner) y ya tiene bastantes ejemplos.</li>
<li><b>Proyecto:</b> aprende de todos los sondeos del proyecto. Buena opción general: más ejemplos y mismas condiciones de trabajo.</li>
<li><b>Todos los proyectos:</b> aprende de todo lo etiquetado en cualquier proyecto. Útil para empezar un sondeo nuevo o para taxones raros; puede empeorar si las imágenes de otros proyectos son muy distintas.</li></ul>
<p>No hay una respuesta fija: depende de tus datos. Por eso existe <b>«Evaluar y comparar»</b>, que prueba las 9 combinaciones con trazas que el modelo no ha visto y te dice cuál acierta más.</p>
<h3>Cómo leer las cifras</h3><ul><li><b>Acierto:</b> porcentaje de trazas bien clasificadas. Ojo: si el 80 % son de un taxón, decir siempre ese taxón ya da un 80 %.</li>
<li><b>Acierto equilibrado:</b> media del acierto de cada taxón. Es la cifra más honesta para comparar.</li>
<li><b>Matriz de confusión:</b> qué taxón se confunde con cuál. Ayuda a decidir si dos taxones deberían unirse o necesitan más ejemplos.</li>
<li><b>Probabilidad por modelo</b> (panel del objeto): reparto del voto entre taxones. Sirve para ver dudas y comparar modelos, pero no es una probabilidad estadística calibrada.</li>
<li><b>Acierto estimado</b> (pestaña Aprendizaje): para k-NN se calcula dejando cada ejemplo fuera; para los otros métodos aparece tras evaluar.</li></ul>
<h3>Buenas prácticas</h3><ul><li>Al menos 10–20 ejemplos por taxón, de distintas partes del sondeo.</li><li>Revisa la pestaña «Ejemplos usados» y desmarca los malos ejemplos (recortes de varias trazas juntas, trazas dudosas, errores de etiqueta).</li>
<li>Usa los mismos ajustes de imagen en todo el proyecto.</li><li>Las sugerencias son ayudas: acepta solo las que compruebes, sobre todo en taxones con pocos ejemplos.</li><li>Para un artículo, indica el método, el modelo (sondeo/proyecto/todos) y el acierto equilibrado de la evaluación.</li></ul>`,
});
Object.assign(D.en, {
  'ml.open': 'Models and training…', 'ml.p.method': 'Method', 'ml.title': 'Ichnotaxon models and training',
  'ml.tab.guide': 'How it works', 'ml.tab.train': 'Method and evaluation', 'ml.tab.examples': 'Examples used', 'ml.tab.others': 'Examples from other projects',
  'ml.m.knn': 'k nearest neighbours (k-NN)', 'ml.m.rf': 'Random Forest', 'ml.m.nb': 'Naive Bayes',
  'ml.d.knn': 'Finds the k most similar labelled traces and votes. Works from 2 examples, updates instantly and is explained by its neighbours. Good with few examples.',
  'ml.d.rf': 'Hundreds of decision trees that vote. Usually the most accurate with many examples (tens per ichnotaxon). Slower.',
  'ml.d.nb': 'Assumes each descriptor follows a bell curve in each ichnotaxon. Very fast and stable with few examples, but simplistic.',
  'ml.trainIntro': 'Choose the method and its parameters; they apply to the three models. Use “Evaluate and compare” to see which works best with your data.',
  'ml.p.k': 'Neighbours (k)', 'ml.p.weights': 'Vote weight', 'ml.p.wDist': 'Closer counts more', 'ml.p.wUni': 'All equal',
  'ml.p.trees': 'Trees', 'ml.p.depth': 'Maximum depth', 'ml.p.leaf': 'Minimum examples per leaf', 'ml.p.balanced': 'Balance rare ichnotaxa',
  'ml.p.priors': 'Prior probability', 'ml.p.pUni': 'Equal for all', 'ml.p.pEmp': 'From the number of examples',
  'ml.paramHelp.knn': 'Small k (3–5) follows individual examples; large k (9–15) smooths but may swallow rare ichnotaxa.',
  'ml.paramHelp.rf': 'More trees = more stable, slower (100 is usually enough). Less depth and more examples per leaf = less memorising.',
  'ml.paramHelp.nb': '“Equal” does not favour the most frequent ichnotaxon.', 'ml.noveltyHelp': 'Novelty tolerance decides when the program says “unlike anything seen”.',
  'ml.eval': 'Evaluate and compare', 'ml.evalHint': 'Tests the 3 methods with the 3 models (grouped cross-validation, seed 42).', 'ml.evalNeed': 'At least 6 examples of 2 ichnotaxa are needed.',
  'ml.evalTitle': 'Evaluation result', 'ml.onCore': 'the labelled traces of this core', 'ml.onProject': 'the labelled traces of the project',
  'ml.evalNote': '{n} traces ({w}) predicted without having been seen (each once, training without its group). First figure: balanced accuracy (mean per-ichnotaxon accuracy); in brackets: overall accuracy.',
  'ml.useBest': 'Use this combination', 'ml.applied': 'Method and model applied.',
  'ml.cm': 'Confusion matrix of the best combination', 'ml.cmNote': 'Rows: true ichnotaxon; columns: predicted.', 'ml.real': 'True', 'ml.pred': 'Predicted',
  'ml.rec': 'Recommendation for your data', 'ml.recNone': 'No labelled traces yet: label some (at least 10 per ichnotaxon).', 'ml.recCounts': 'Examples: {c} in this core, {p} in the project, {a} in all projects.',
  'ml.recFew': 'Ichnotaxa with fewer than 10 examples: {l}.', 'ml.recBest': 'Best evaluated combination: “{s}” model with {m} — balanced accuracy {v} %.',
  'ml.recClose': 'Other combinations are within 3 points; the simplest is recommended (simplest method first, then the most local model).', 'ml.recEval': 'Run “Evaluate and compare” to find the best combination for your data.',
  'ml.exScope': 'Model', 'ml.exCount': '{n} examples in use of {t}', 'ml.exHelp': 'Untick “use” for poor examples: they stay labelled and counted, but the model does not learn from them. Click an image to go to the trace.',
  'ml.use': 'use', 'ml.remove': 'Remove', 'ml.library': 'Library', 'ml.noImg': 'no image', 'ml.fewWarn': 'few examples',
  'ml.othersIntro': 'Labelled traces of other projects. Tick and add them to this project’s library to use them in the core and project models.',
  'ml.othersNone': 'No labelled traces in other projects yet.', 'ml.pick': 'pick', 'ml.inLib': 'in library', 'ml.addLib': 'Add {n} to the library', 'ml.added': '{n} examples added to the library.',
  'ml.guide': `<h3>What does the program do?</h3><p>Supervised learning: you label some traces (examples) and it learns to recognise the others from 12 measured descriptors (size, shape, fill brightness/texture/colour, contrast).</p>
<h3>Methods</h3><ul><li><b>k-NN</b>: votes of the k most similar examples; best with few examples (default).</li><li><b>Random Forest</b>: many decision trees; usually best with tens of examples per ichnotaxon.</li><li><b>Naive Bayes</b>: bell-curve model per descriptor; quick baseline.</li></ul>
<h3>Core, project or all projects?</h3><p>Core: only this core. Project: all cores of the project (good default). All projects: everything labelled anywhere (useful for new cores or rare ichnotaxa). Use “Evaluate and compare” to decide with your data.</p>
<h3>Reading the figures</h3><p>Balanced accuracy is the fairest comparison; the confusion matrix shows which ichnotaxa are confused; probabilities are vote shares, not calibrated probabilities.</p>
<h3>Good practice</h3><p>10–20 examples per ichnotaxon, review and untick poor examples, keep image settings consistent, and report method, model and balanced accuracy in papers.</p>`,
});

Object.assign(D.es, {
 "tour.0.t": "Tus proyectos",
 "tour.1.t": "Todos los proyectos",
 "tour.2.t": "Análisis multiproyecto",
 "tour.3.t": "Volver a esta pantalla",
 "tour.4.t": "Sondeos del proyecto",
 "tour.5.t": "Pestaña Bioturbación",
 "tour.6.t": "Añadir imágenes",
 "tour.7.t": "Realce de la imagen",
 "tour.8.t": "Detectar trazas",
 "tour.9.t": "Herramientas",
 "tour.10.t": "Icnotaxones",
 "tour.11.t": "Panel de la traza",
 "tour.12.t": "Modelos y entrenamiento",
 "tour.13.t": "Resultados",
 "tour.14.t": "Registro del sondeo",
 "tour.15.t": "Datos",
 "tour.16.t": "Multiproxy: paso 1",
 "tour.17.t": "Capas e intervalos",
 "tour.18.t": "Variables",
 "tour.19.t": "Entrenar el clasificador",
 "tour.20.t": "Registros multiproxy",
 "tour.21.t": "Mapa por edad",
 "tour.22.t": "Modelo",
 "tour.23.t": "Figuras",
 "tour.24.t": "Ayuda",
 "tour.0.b": "Cada <b>proyecto</b> agrupa sondeos de un estudio. Aquí los abres, renombras, exportas o borras. Este es el <b>proyecto de entrenamiento</b>: 7 sondeos ficticios del Mediterráneo con datos inventados, para practicar sin miedo a estropear nada.",
 "tour.1.b": "Esta pestaña reúne los sondeos de <b>todos</b> tus proyectos: tabla y mapa multiproyecto. El mapa se personaliza (fondo, símbolos, etiquetas) y se mueve con la rueda y arrastrando.",
 "tour.2.b": "Marca sondeos de proyectos distintos y pulsa «Analizar»: se crea un proyecto de análisis con una copia de sus datos para usar Multiproxy y Figuras con todos ellos.",
 "tour.3.b": "El botón ⌂ Proyecto abre la pantalla inicial en cualquier momento. Todo se guarda solo en el navegador; conviene elegir además una carpeta de copias de seguridad.",
 "tour.4.b": "Elige el sondeo con el que trabajas. <b>+</b> añade un sondeo y <b>✎</b> edita su nombre, posición (lat, lon), profundidad de agua y unidades. Cada sondeo guarda sus imágenes, datos, modelo de edad e intervalos.",
 "tour.5.b": "Aquí se trabaja la <b>icnología</b> sobre las imágenes del sondeo: detectar trazas, asignarles icnotaxón y calcular la bioturbación. ENT-03 tiene una imagen sintética con trazas dibujadas.",
 "tour.6.b": "Añade fotos o escáneres del sondeo (varias secciones). Indica la profundidad del <b>techo y muro</b> de cada imagen y dibuja la zona de análisis si hay bordes o etiquetas.",
 "tour.7.b": "Ajusta brillo, contraste o canales para que las trazas se distingan de la matriz. «Elegir el ajuste que más separa» prueba varios automáticamente. Usa el mismo ajuste en todo el proyecto.",
 "tour.8.b": "Busca manchas más oscuras (o claras) que la matriz. Los parámetros de abajo controlan el umbral y el tamaño mínimo. Después revisa: puedes borrar, unir o dibujar a mano.",
 "tour.9.b": "Seleccionar (clic, Mayús/Ctrl o recuadro arrastrando), varita, pincel, lazo, goma, excluir zonas y mover. Selecciona varias trazas a la vez para asignarlas juntas.",
 "tour.10.b": "Lista de clases con su color. Haz clic en una para activarla o pulsa su número (1–9, 0) para asignarla a la traza seleccionada. Puedes añadir icnotaxones nuevos.",
 "tour.11.b": "Datos de la traza seleccionada: clase, sugerencia automática, <b>probabilidad de cada icnotaxón según los tres modelos</b> (sondeo, proyecto, todos), profundidad y tamaño. En este proyecto la mitad de las trazas ya están etiquetadas: el resto tiene sugerencias.",
 "tour.12.b": "Aquí controlas el <b>aprendizaje automático</b>: guía para no especialistas, elegir método (k-NN, Random Forest, Bayes) y parámetros, evaluar cuál acierta más, ver y quitar los ejemplos de entrenamiento y traer ejemplos de otros proyectos.",
 "tour.13.b": "Bioturbación por tramos de profundidad: porcentaje total y por icnotaxón, índice de bioturbación (BI) e índice ii. Se exportan en CSV.",
 "tour.14.b": "Columna del sondeo en profundidad o edad con la imagen, las trazas, la bioturbación y los registros que elijas. Se puede abrir en otra ventana y exportar en SVG.",
 "tour.15.b": "Todos los datos del proyecto en una tabla, distinguiendo importados, creados y calculados. Puedes crear <b>columnas con fórmulas</b> (p. ej. <code>[XRF Ba/Ti] / TOC_pct</code>), columnas manuales y usar una hoja libre tipo Excel.",
 "tour.16.b": "Importa registros numéricos (geoquímica, foraminíferos, TOC…) e <b>intervalos descritos</b> (litología, turbiditas, capas orgánicas). Aquí ya están cargados los 7 sondeos con sus intervalos.",
 "tour.17.b": "Los intervalos se organizan en <b>capas</b> (Litología, Capas orgánicas, Periodo climático…) que pueden tener subcapas. Marca intervalos arrastrando sobre el registro del sondeo.",
 "tour.18.b": "Elige qué registros usa el clasificador de intervalos. Mejor pocas variables con sentido geológico que muchas. Los huecos se pueden descartar o rellenar con la media.",
 "tour.19.b": "Aprende de los intervalos descritos (aquí «Capas orgánicas» solo en 4 sondeos) y <b>sugiere esos intervalos en los demás sondeos</b>. La validación deja un sondeo fuera cada vez para medir si funciona en sondeos nuevos.",
 "tour.20.b": "Registros del sondeo elegido con las bandas de intervalos descritos y la clasificación automática. «Probar la autoclasificación» colorea lo que el modelo propone.",
 "tour.21.b": "Mapa de los sondeos en una ventana de edad (aquí 6–10 ka): clase dominante o valor de una variable, con interpolación opcional. «Personalizar mapa y zoom» cambia fondo (físico, batimétrico, foto aérea…), símbolos, etiquetas y colores.",
 "tour.22.b": "Detalle del clasificador de intervalos: importancia de cada variable, matriz de confusión y acierto por clase. Úsalo para decidir si el modelo es fiable.",
 "tour.23.b": "Figuras para publicar: trazas representativas de cada icnotaxón, sondeo entero interpretado, registros y mapas, con título y pie, en SVG o PNG.",
 "tour.24.b": "En Ayuda tienes la explicación de cada parte, el botón para repetir este recorrido y la opción de mostrar u ocultar los carteles de ayuda. ¡Ya puedes practicar con el proyecto de entrenamiento!",
 "tour.start": "Recorrido guiado",
 "tour.end": "Salir",
 "tour.prev": "Anterior",
 "tour.next": "Siguiente",
 "tour.finish": "Terminar",
 "tut.open": "Proyecto de entrenamiento (recorrido guiado)",
 "tut.name": "Proyecto de entrenamiento",
 "tut.notes": "Proyecto para aprender a usar SedCoreTool. Los 7 sondeos son FICTICIOS y sus datos son SINTÉTICOS (tools/make_tutorial.py): no son datos geológicos.",
 "tut.coreNote": "Sondeo ficticio con datos sintéticos (proyecto de entrenamiento).",
 "tip.title": "Ayuda",
 "tip.tour": "Recorrido de esta parte",
 "tip.hide": "Ocultar ayudas",
 "tip.toggle": "Mostrar carteles de ayuda",
 "tip.section.classes": "Selecciona una traza en la imagen y pulsa el número de su icnotaxón (1–9, 0). Con Mayús/Ctrl o arrastrando un recuadro seleccionas varias. En ENT-03 la mitad ya está etiquetada: prueba a etiquetar las demás.",
 "tip.section.object": "Mira la tabla de probabilidades: compara qué dice el modelo del sondeo, del proyecto y de todos los proyectos. Si la sugerencia es buena, pulsa «Aceptar».",
 "tip.section.learn": "Abre «Modelos y entrenamiento…» y lee «Cómo funciona». Luego pulsa «Evaluar y comparar» para ver qué método acierta más con estas trazas.",
 "tip.section.results": "Cambia el tamaño de tramo (arriba, «Tramo») y fíjate en cómo baja la bioturbación en la banda oscura de 60–78 cm.",
 "tip.log": "Elige qué pistas mostrar y cambia entre profundidad y edad. Prueba «Abrir en ventana nueva» para tener el registro al lado mientras etiquetas.",
 "tip.data": "Crea una columna calculada, por ejemplo <code>[XRF Ba/Ti] * TOC_pct</code>, y mírala luego en Multiproxy.",
 "tip.geo.logs": "Pulsa «Entrenar» (paso 4): el modelo aprende la capa orgánica de 4 sondeos. Luego elige ENT-02, ENT-05 o ENT-06 (sin intervalos descritos) y pulsa «Probar la autoclasificación».",
 "tip.geo.map": "Mueve la ventana de edad con ◀ ▶ y abre «Personalizar mapa y zoom» para probar otro fondo y otros símbolos.",
 "tip.geo.model": "Mira la matriz de confusión: ¿confunde la capa orgánica con el resto? Prueba a quitar variables en el paso 2 y vuelve a entrenar.",
 "tip.fig": "Elige «Trazas representativas» y genera una lámina con 3 ejemplos de cada icnotaxón. Expórtala en SVG para editarla.",
 "tip.section": "",
 "tip.geo": ""
});
Object.assign(D.en, {
 "tour.0.t": "Your projects",
 "tour.1.t": "All projects",
 "tour.2.t": "Multiproject analysis",
 "tour.3.t": "Back to this screen",
 "tour.4.t": "Cores of the project",
 "tour.5.t": "Bioturbation tab",
 "tour.6.t": "Add images",
 "tour.7.t": "Image enhancement",
 "tour.8.t": "Detect traces",
 "tour.9.t": "Tools",
 "tour.10.t": "Ichnotaxa",
 "tour.11.t": "Trace panel",
 "tour.12.t": "Models and training",
 "tour.13.t": "Results",
 "tour.14.t": "Core log",
 "tour.15.t": "Data",
 "tour.16.t": "Multiproxy: step 1",
 "tour.17.t": "Layers and intervals",
 "tour.18.t": "Variables",
 "tour.19.t": "Train the classifier",
 "tour.20.t": "Multiproxy logs",
 "tour.21.t": "Map by age",
 "tour.22.t": "Model",
 "tour.23.t": "Figures",
 "tour.24.t": "Help",
 "tour.0.b": "Each project groups the cores of a study. This is the training project: 7 fictitious Mediterranean cores with invented data.",
 "tour.1.b": "Cores of every project: table and multiproject map (customisable, zoom with the wheel).",
 "tour.2.b": "Tick cores of different projects and analyse them together in Multiproxy and Figures.",
 "tour.3.b": "⌂ Project opens the start screen at any time. Everything is saved in the browser; also choose a backup folder.",
 "tour.4.b": "Choose the core; + adds one and ✎ edits name, position and units.",
 "tour.5.b": "Ichnology on the core images: detect traces, assign ichnotaxa and compute bioturbation.",
 "tour.6.b": "Add core photos or scans and set the top and bottom depth of each image.",
 "tour.7.b": "Adjust the image so that traces stand out; use the same setting in the whole project.",
 "tour.8.b": "Finds patches darker (or lighter) than the matrix; then review, delete, merge or draw.",
 "tour.9.b": "Select (click, Shift/Ctrl or box), wand, brush, lasso, eraser, exclude areas and pan.",
 "tour.10.b": "Click a class or press its number to assign it to the selected trace.",
 "tour.11.b": "Class, suggestion and probability of each ichnotaxon according to the three models.",
 "tour.12.b": "Machine-learning control: guide, method, parameters, evaluation and training examples.",
 "tour.13.b": "Bioturbation per depth bin: total and per ichnotaxon, BI and ii; CSV export.",
 "tour.14.b": "Core column in depth or age with image, traces, bioturbation and records.",
 "tour.15.b": "All project data, computed columns with formulas and a free spreadsheet.",
 "tour.16.b": "Import numeric records and described intervals.",
 "tour.17.b": "Intervals are organised in layers that can have sublayers; mark them by dragging on the log.",
 "tour.18.b": "Choose the records used by the interval classifier.",
 "tour.19.b": "Learns from described intervals and suggests them in the other cores; validated leaving one core out.",
 "tour.20.b": "Records with the bands of described and suggested intervals.",
 "tour.21.b": "Map of the cores in an age window; customise background, symbols and labels.",
 "tour.22.b": "Variable importance, confusion matrix and per-class accuracy of the interval classifier.",
 "tour.23.b": "Publication figures: representative traces, interpreted core, logs and maps.",
 "tour.24.b": "Help explains every part, restarts this tour and toggles the help cards.",
 "tour.start": "Guided tour",
 "tour.end": "Exit",
 "tour.prev": "Back",
 "tour.next": "Next",
 "tour.finish": "Finish",
 "tut.open": "Training project (guided tour)",
 "tut.name": "Training project",
 "tut.notes": "Project to learn SedCoreTool. The 7 cores are FICTITIOUS and their data SYNTHETIC (tools/make_tutorial.py).",
 "tut.coreNote": "Fictitious core with synthetic data (training project).",
 "tip.title": "Help",
 "tip.tour": "Tour of this part",
 "tip.hide": "Hide help",
 "tip.toggle": "Show help cards",
 "tip.section.classes": "Select a trace and press the number of its ichnotaxon. Half of the ENT-03 traces are already labelled.",
 "tip.section.object": "Compare the probabilities of the core, project and all-projects models; accept good suggestions.",
 "tip.section.learn": "Open “Models and training…”, read “How it works” and run “Evaluate and compare”.",
 "tip.section.results": "Change the bin size and watch bioturbation drop in the dark band at 60–78 cm.",
 "tip.log": "Choose tracks and switch between depth and age; try opening the log in a new window.",
 "tip.data": "Create a computed column such as [XRF Ba/Ti] * TOC_pct.",
 "tip.geo.logs": "Press “Train”, then pick ENT-02, ENT-05 or ENT-06 and “Test the autoclassification”.",
 "tip.geo.map": "Move the age window with ◀ ▶ and customise the map.",
 "tip.geo.model": "Check the confusion matrix; try fewer variables and retrain.",
 "tip.fig": "Make a plate with 3 representative traces of each ichnotaxon and export it as SVG.",
 "tip.section": "",
 "tip.geo": ""
});

Object.assign(D.es, {"ip.title": "Interpolación y escala de color", "ip.on": "Interpolar", "ip.method": "Método", "ip.m.idw": "Inverso de la distancia", "ip.m.nearest": "Vecino más cercano", "ip.m.tin": "Triangulación lineal", "ip.m.mincurv": "Curvatura mínima", "ip.m.rbf": "Funciones de base radial", "ip.m.kriging": "Kriging", "ip.m.movavg": "Media móvil", "ip.d.idw": "Media de los sondeos ponderada por 1/distancia^potencia. Sencillo y robusto; crea «ojos de buey» alrededor de cada sondeo. Potencia alta = influencia más local.", "ip.d.nearest": "Cada celda toma el valor del sondeo más cercano (polígonos de Voronoi). Útil para datos por zonas o categóricos.", "ip.d.tin": "Triangula los sondeos (Delaunay) e interpola linealmente dentro de cada triángulo. No extrapola fuera del contorno de los sondeos.", "ip.d.mincurv": "Superficie más suave que pasa por los sondeos (spline de placa delgada, equivalente a la curvatura mínima de Surfer). Puede pasarse de los valores observados lejos de los datos.", "ip.d.rbf": "Combinación de funciones centradas en cada sondeo (multicuádrica, gaussiana o placa delgada). «Forma» controla la anchura; «suavizado» > 0 deja de pasar exactamente por los datos.", "ip.d.kriging": "Kriging ordinario: pondera según cómo varía el valor con la distancia (variograma), ajustado automáticamente o a mano. Es el método geoestadístico de referencia; con pocos sondeos el variograma es poco fiable.", "ip.d.movavg": "Media de los sondeos dentro del radio de búsqueda. Suaviza mucho; las celdas sin sondeos cerca quedan vacías.", "ip.power": "Potencia", "ip.radius": "Radio de búsqueda (km, 0 = sin límite)", "ip.neigh": "Máx. sondeos (0 = todos)", "ip.smooth": "Suavizado", "ip.rbf": "Función", "ip.shape": "Forma (km)", "ip.r.mq": "Multicuádrica", "ip.r.gauss": "Gaussiana", "ip.r.tps": "Placa delgada", "ip.vmodel": "Variograma", "ip.v.spherical": "Esférico", "ip.v.exponential": "Exponencial", "ip.v.gaussian": "Gaussiano", "ip.v.linear": "Lineal", "ip.auto": "Ajuste automático", "ip.nugget": "Pepita", "ip.sill": "Meseta", "ip.range": "Alcance (km)", "ip.vario": "Variograma {m}: pepita {n}, meseta {s}, alcance {r} km.", "ip.few": "Con menos de 15 sondeos el variograma es poco fiable.", "ip.fallback": "No se pudo resolver el sistema: se usa el inverso de la distancia.", "ip.res": "Celdas a lo ancho (más = más pequeñas)", "ip.hull": "Solo dentro del contorno de los sondeos", "ip.mask": "Rellenar", "ip.mask.both": "Mar y tierra", "ip.mask.sea": "Solo mar", "ip.mask.land": "Solo tierra", "ip.opacity": "Opacidad", "ip.contours": "Isolíneas", "ip.levels": "Nº de isolíneas", "ip.labels": "Valores en las isolíneas", "ip.ramp": "Escala de color", "ip.ramp.div": "Divergente azul–rojo (suave)", "ip.ramp.bluered": "Divergente azul–rojo", "ip.ramp.viridis": "Viridis", "ip.ramp.magma": "Magma", "ip.ramp.terrain": "Terreno", "ip.ramp.ocean": "Océano", "ip.ramp.grey": "Grises", "ip.ramp.rainbow": "Arcoíris", "ip.reverse": "Invertir", "ip.scale": "Rango de color", "ip.sc.sym2": "−2 a 2 (z)", "ip.sc.auto": "Mínimo a máximo", "ip.sc.symauto": "Simétrico (±máx.)", "ip.sc.manual": "Manual", "ip.vmin": "Mínimo", "ip.vmax": "Máximo", "ip.steps": "Clases (0 = continuo)", "ip.cores": "Sondeos en el mapa ({n} de {t})", "ip.noPos": "sin coordenadas"});
Object.assign(D.en, {"ip.title": "Interpolation and colour scale", "ip.on": "Interpolate", "ip.method": "Method", "ip.m.idw": "Inverse distance", "ip.m.nearest": "Nearest neighbour", "ip.m.tin": "Linear triangulation", "ip.m.mincurv": "Minimum curvature", "ip.m.rbf": "Radial basis functions", "ip.m.kriging": "Kriging", "ip.m.movavg": "Moving average", "ip.d.idw": "Weighted by 1/distance^power; simple and robust, “bull’s eyes” around cores.", "ip.d.nearest": "Value of the nearest core (Voronoi polygons).", "ip.d.tin": "Delaunay triangulation with linear interpolation; no extrapolation.", "ip.d.mincurv": "Smoothest surface through the cores (thin-plate spline).", "ip.d.rbf": "Sum of functions centred on each core; shape sets the width, smoothing > 0 relaxes exact fit.", "ip.d.kriging": "Ordinary kriging with a variogram fitted automatically or by hand.", "ip.d.movavg": "Mean of the cores within the search radius.", "ip.power": "Power", "ip.radius": "Search radius (km, 0 = none)", "ip.neigh": "Max. cores (0 = all)", "ip.smooth": "Smoothing", "ip.rbf": "Function", "ip.shape": "Shape (km)", "ip.r.mq": "Multiquadric", "ip.r.gauss": "Gaussian", "ip.r.tps": "Thin plate", "ip.vmodel": "Variogram", "ip.v.spherical": "Spherical", "ip.v.exponential": "Exponential", "ip.v.gaussian": "Gaussian", "ip.v.linear": "Linear", "ip.auto": "Automatic fit", "ip.nugget": "Nugget", "ip.sill": "Sill", "ip.range": "Range (km)", "ip.vario": "{m} variogram: nugget {n}, sill {s}, range {r} km.", "ip.few": "With fewer than 15 cores the variogram is unreliable.", "ip.fallback": "System could not be solved: inverse distance used.", "ip.res": "Cells across (more = smaller)", "ip.hull": "Only inside the outline of the cores", "ip.mask": "Fill", "ip.mask.both": "Sea and land", "ip.mask.sea": "Sea only", "ip.mask.land": "Land only", "ip.opacity": "Opacity", "ip.contours": "Contours", "ip.levels": "Number of contours", "ip.labels": "Contour labels", "ip.ramp": "Colour scale", "ip.ramp.div": "Diverging blue–red (soft)", "ip.ramp.bluered": "Diverging blue–red", "ip.ramp.viridis": "Viridis", "ip.ramp.magma": "Magma", "ip.ramp.terrain": "Terrain", "ip.ramp.ocean": "Ocean", "ip.ramp.grey": "Greys", "ip.ramp.rainbow": "Rainbow", "ip.reverse": "Reverse", "ip.scale": "Colour range", "ip.sc.sym2": "−2 to 2 (z)", "ip.sc.auto": "Minimum to maximum", "ip.sc.symauto": "Symmetric (±max)", "ip.sc.manual": "Manual", "ip.vmin": "Minimum", "ip.vmax": "Maximum", "ip.steps": "Classes (0 = continuous)", "ip.cores": "Cores on the map ({n} of {t})", "ip.noPos": "no coordinates"});

Object.assign(D.es, {"ms.proj": "Proyección", "ms.proj.plate": "Equirrectangular (placa cuadrada)", "ms.proj.mercator": "Mercator", "ms.proj.laea": "Lambert azimutal de áreas iguales (sin fondo raster)", "ms.big": "Ampliar el mapa (ocultar el panel)", "ms.full": "Pantalla completa", "ms.noFull": "El navegador no permite la pantalla completa aquí."});
Object.assign(D.en, {"ms.proj": "Projection", "ms.proj.plate": "Equirectangular (plate carrée)", "ms.proj.mercator": "Mercator", "ms.proj.laea": "Lambert azimuthal equal-area (no raster background)", "ms.big": "Enlarge the map (hide the panel)", "ms.full": "Full screen", "ms.noFull": "Full screen is not allowed here."});

Object.assign(D.es, {"data.plot": "Gráficos (tipo Grapher)", "pl.plot": "Gráfico", "pl.dup": "Duplicar", "pl.name": "Nombre", "pl.layout": "Tipo de gráfico", "pl.l.strat": "Registro estratigráfico (paneles)", "pl.l.xy": "XY (dispersión, líneas, barras)", "pl.l.stratHelp": "Un panel por variable, todos con el mismo eje vertical de profundidad o edad (hacia abajo). Varios sondeos = una línea de color por sondeo.", "pl.l.xyHelp": "Cualquier columna contra cualquier otra: líneas, puntos, barras, áreas; eje Y secundario, ejes logarítmicos o invertidos y ajustes de curva con ecuación y R².", "pl.cores": "Sondeos", "pl.vaxis": "Eje vertical", "pl.xaxis": "Eje X", "pl.panels": "Paneles (una variable cada uno)", "pl.yvars": "Variables Y", "pl.addy": "Añadir variable", "pl.t.line": "Línea", "pl.t.scatter": "Puntos", "pl.t.linesym": "Línea y puntos", "pl.t.step": "Escalón", "pl.t.area": "Área", "pl.t.bar": "Barras", "pl.f.none": "Sin ajuste", "pl.f.linear": "Lineal", "pl.f.poly": "Polinómico", "pl.f.exp": "Exponencial", "pl.f.power": "Potencial", "pl.f.log": "Logarítmico", "pl.f.movavg": "Media móvil", "pl.deg": "Grado", "pl.window": "Ventana (puntos)", "pl.inv": "inv.", "pl.color": "Color", "pl.del": "Quitar", "pl.axes": "Ejes", "pl.xmin": "X mín.", "pl.xmax": "X máx.", "pl.ymin": "Y mín.", "pl.ymax": "Y máx.", "pl.vmin": "Desde", "pl.vmax": "Hasta", "pl.xlog": "X logarítmico", "pl.xinv": "X invertido", "pl.ylog": "Y logarítmico", "pl.yinv": "Y invertido", "pl.vup": "Profundidad hacia arriba", "pl.y2label": "Título del eje Y2", "pl.look": "Aspecto", "pl.title": "Título", "pl.width": "Ancho (px)", "pl.height": "Alto (px)", "pl.pw": "Ancho de panel", "pl.legend": "Leyenda", "pl.grid": "Cuadrícula", "pl.empty": "Elige al menos un sondeo y una variable.", "pl.fits": "Ajustes", "pl.series": "Serie", "pl.eq": "Ecuación", "pl.stats": "Estadística", "pl.mean": "Media", "pl.sd": "Desv. típica", "pl.min": "Mín.", "pl.median": "Mediana", "pl.max": "Máx."});
Object.assign(D.en, {"data.plot": "Plots (Grapher-like)", "pl.plot": "Plot", "pl.dup": "Duplicate", "pl.name": "Name", "pl.layout": "Plot type", "pl.l.strat": "Stratigraphic log (panels)", "pl.l.xy": "XY (scatter, lines, bars)", "pl.l.stratHelp": "One panel per variable sharing the vertical depth/age axis (downwards).", "pl.l.xyHelp": "Any column against any other; secondary Y axis, log/inverted axes, curve fits with equation and R².", "pl.cores": "Cores", "pl.vaxis": "Vertical axis", "pl.xaxis": "X axis", "pl.panels": "Panels (one variable each)", "pl.yvars": "Y variables", "pl.addy": "Add variable", "pl.t.line": "Line", "pl.t.scatter": "Symbols", "pl.t.linesym": "Line and symbols", "pl.t.step": "Step", "pl.t.area": "Area", "pl.t.bar": "Bars", "pl.f.none": "No fit", "pl.f.linear": "Linear", "pl.f.poly": "Polynomial", "pl.f.exp": "Exponential", "pl.f.power": "Power", "pl.f.log": "Logarithmic", "pl.f.movavg": "Moving average", "pl.deg": "Degree", "pl.window": "Window (points)", "pl.inv": "inv.", "pl.color": "Colour", "pl.del": "Remove", "pl.axes": "Axes", "pl.xmin": "X min", "pl.xmax": "X max", "pl.ymin": "Y min", "pl.ymax": "Y max", "pl.vmin": "From", "pl.vmax": "To", "pl.xlog": "Log X", "pl.xinv": "Inverted X", "pl.ylog": "Log Y", "pl.yinv": "Inverted Y", "pl.vup": "Depth upwards", "pl.y2label": "Y2 axis title", "pl.look": "Appearance", "pl.title": "Title", "pl.width": "Width (px)", "pl.height": "Height (px)", "pl.pw": "Panel width", "pl.legend": "Legend", "pl.grid": "Grid", "pl.empty": "Choose at least one core and one variable.", "pl.fits": "Fits", "pl.series": "Series", "pl.eq": "Equation", "pl.stats": "Statistics", "pl.mean": "Mean", "pl.sd": "SD", "pl.min": "Min", "pl.median": "Median", "pl.max": "Max"});

Object.assign(D.es, { 'age.reversal': '⚠ {n} inversiones: la edad disminuye hacia abajo en algún punto; revisa el modelo (la conversión edad → profundidad será ambigua).' });
Object.assign(D.en, { 'age.reversal': '⚠ {n} reversals: age decreases downwards somewhere; check the model (age → depth conversion will be ambiguous).' });

Object.assign(D.es, { 'save.quota': 'El navegador no tiene más espacio para este proyecto. Haz una copia de seguridad completa y borra proyectos que no uses.' });
Object.assign(D.en, { 'save.quota': 'The browser has no more space for this project. Make a full backup and delete projects you do not use.' });

// V22 (council review): one name per concept, final wording
Object.assign(D.es, {"mode.log": "Columna", "win.title.corelog": "Columna del sondeo", "fig.t.log": "Columna del sondeo (ventana actual)", "log.empty": "Añade imágenes del sondeo para ver su columna.", "fig.logNote": "Usa la ventana, la altura y las columnas elegidas en la pestaña Columna.", "tour.14.t": "Columna del sondeo", "geo.tab.logs": "Curvas", "s4": "Tramos de análisis", "a.bin": "Píxeles por tramo", "log.window": "Ventana", "view.overlay": "Opacidad de trazas", "geo.s3": "Capas de intervalos y categorías", "geo.useRules": "Usar reglas para asignar categorías", "geo.notIchno": "Este clasificador de intervalos es independiente del que sugiere icnotaxones en Bioturbación.", "tip.log": "Elige qué columnas mostrar y cambia entre profundidad y edad. Prueba «Abrir en ventana nueva» para tenerla al lado mientras etiquetas.", "tip.section.results": "Cambia «Píxeles por tramo» (paso 4 del panel izquierdo) y fíjate en cómo baja la bioturbación en la banda oscura de 60–78 cm.", "tip.fig": "Elige «Trazas representativas» y genera una lámina con varios ejemplos de cada icnotaxón. Expórtala en SVG para editarla.", "tab.learn": "Sugerencias", "l.clearLib": "Quitar ejemplos importados", "data.plot": "Gráficos", "s1": "Imágenes del sondeo", "sec.section": "Imagen (sección)", "confirm.click": "¿Seguro? Pulsa otra vez", "confirm.secDel": "¿Quitar la imagen y sus {n} trazas? Pulsa otra vez", "confirm.layerDel": "¿Quitar la capa y sus {n} intervalos? Pulsa otra vez", "start.title": "Primeros pasos", "start.learn": "Aprender con el proyecto de entrenamiento", "start.learnNote": "7 sondeos ficticios y un recorrido guiado de 5 minutos.", "start.new": "Crear un proyecto con mis datos", "start.newNote": "Escribe un nombre arriba y pulsa «Crear»; después añade imágenes o importa datos.", "bk.summary": "Copias de seguridad", "mode.hint.section": "Imágenes del sondeo: detectar trazas, icnotaxones y bioturbación", "mode.hint.log": "Columna del sondeo en profundidad o edad", "mode.hint.data": "Todos los datos, columnas calculadas y gráficos", "mode.hint.geo": "Curvas, mapa y clasificación de intervalos de todos los sondeos", "mode.hint.fig": "Figuras para publicar", "aria.prev": "Ventana anterior", "aria.next": "Ventana siguiente", "aria.zoomIn": "Acercar", "aria.zoomOut": "Alejar", "aria.addRatio": "Añadir cociente", "geo.modelTrain": "Entrenar y clasificar", "rf.trees": "Nº de árboles", "rf.maxDepth": "Profundidad máxima", "rf.minLeaf": "Muestras mínimas por hoja", "rf.mtry": "Variables por división", "rf.bins": "Cortes por variable", "rf.bootstrap": "Remuestreo (bootstrap)", "rf.balanced": "Equilibrar clases", "knn.k": "Vecinos (k)", "knn.weights": "Peso del voto", "nb.smoothing": "Suavizado de varianza", "nb.priors": "Probabilidad de partida", "kmeans.k": "Nº de grupos", "kmeans.restarts": "Reinicios", "kmeans.maxIter": "Iteraciones máximas", "cv.cover": "Con la probabilidad mínima {p}: se clasifica el {s} % de las muestras, con un acierto del {a} %.", "cv.fold": "Acierto equilibrado por sondeo dejado fuera: {m} ± {sd} % ({n} sondeos).", "cv.rules": "Solo se puntúan los intervalos descritos (las etiquetas por regla se usan para entrenar, no para evaluar)."});
Object.assign(D.en, {"mode.log": "Core column", "win.title.corelog": "Core column", "fig.t.log": "Core column (current window)", "log.empty": "Add core images to see the column.", "fig.logNote": "Uses the window, height and columns chosen in the Core column tab.", "tour.14.t": "Core column", "geo.tab.logs": "Curves", "s4": "Analysis bins", "a.bin": "Pixels per bin", "log.window": "Window", "view.overlay": "Trace opacity", "geo.s3": "Interval layers and categories", "geo.useRules": "Use rules to assign categories", "geo.notIchno": "This interval classifier is independent of the ichnotaxon suggestions in Bioturbation.", "tip.log": "Choose which columns to show and switch between depth and age.", "tip.section.results": "Change “Pixels per bin” (step 4, left panel) and watch bioturbation drop in the dark band at 60–78 cm.", "tip.fig": "Make a plate with several representative traces of each ichnotaxon and export it as SVG.", "tab.learn": "Suggestions", "l.clearLib": "Remove imported examples", "data.plot": "Plots", "s1": "Core images", "sec.section": "Image (section)", "confirm.click": "Sure? Click again", "confirm.secDel": "Remove the image and its {n} traces? Click again", "confirm.layerDel": "Remove the layer and its {n} intervals? Click again", "start.title": "Getting started", "start.learn": "Learn with the training project", "start.learnNote": "7 fictitious cores and a 5-minute guided tour.", "start.new": "Create a project with my data", "start.newNote": "Type a name above and press “Create”; then add images or import data.", "bk.summary": "Backups", "mode.hint.section": "Core images: detect traces, ichnotaxa and bioturbation", "mode.hint.log": "Core column in depth or age", "mode.hint.data": "All data, computed columns and plots", "mode.hint.geo": "Curves, map and interval classification of all cores", "mode.hint.fig": "Publication figures", "aria.prev": "Previous window", "aria.next": "Next window", "aria.zoomIn": "Zoom in", "aria.zoomOut": "Zoom out", "aria.addRatio": "Add ratio", "geo.modelTrain": "Train and classify", "rf.trees": "Number of trees", "rf.maxDepth": "Maximum depth", "rf.minLeaf": "Minimum samples per leaf", "rf.mtry": "Variables per split", "rf.bins": "Cuts per variable", "rf.bootstrap": "Bootstrap", "rf.balanced": "Balance classes", "knn.k": "Neighbours (k)", "knn.weights": "Vote weight", "nb.smoothing": "Variance smoothing", "nb.priors": "Prior probability", "kmeans.k": "Number of groups", "kmeans.restarts": "Restarts", "kmeans.maxIter": "Maximum iterations", "cv.cover": "With minimum probability {p}: {s} % of samples are classified, with {a} % accuracy.", "cv.fold": "Balanced accuracy per left-out core: {m} ± {sd} % ({n} cores).", "cv.rules": "Only described intervals are scored (rule labels are used for training, not for evaluation)."});

// V23 plurals (singular forms; t() picks them when n = 1)
Object.assign(D.es, { 'home.cores.one': '1 sondeo', 'home.nImg.one': '1 imagen', 'home.shared.one': '1 compartido con otros proyectos', 'mp.sel.one': '1 sondeo marcado' });
Object.assign(D.en, { 'home.cores.one': '1 core', 'home.nImg.one': '1 image', 'home.shared.one': '1 shared with other projects', 'mp.sel.one': '1 core ticked' });
// V23
Object.assign(D.es, {"ui.togglePanel": "Ocultar o mostrar el panel (arrastra el borde para cambiar su anchura; doble clic: anchura inicial)", "ui.resizeMap": "Arrastra para cambiar el tamaño del mapa (doble clic: tamaño inicial)", "home.tagline": "Análisis de sondeos: icnología, registros e intervalos", "home.newProject": "Nuevo proyecto", "home.search": "Buscar proyecto o sondeo…", "home.tab.projects": "Proyectos", "home.tab.all": "Todos los sondeos", "home.emptyTitle": "Todavía no hay proyectos", "home.emptyText": "Un proyecto agrupa los sondeos de un estudio: sus imágenes, datos, modelos de edad e intervalos. Crea uno con tus datos, importa un archivo de proyecto (.corantool.json) o aprende con el proyecto de entrenamiento (7 sondeos ficticios y un recorrido guiado).", "home.now": "editado ahora", "home.min": "editado hace {n} min", "home.hours": "editado hace {n} h", "home.nImg": "{n} imágenes", "home.nVar": "{n} variables", "home.alsoIn": "También en: {p}", "home.shared": "{n} compartidos con otros proyectos", "home.noCores": "Sin sondeos todavía", "home.noMatch": "Ningún proyecto coincide con la búsqueda.", "home.kindTutorial": "entrenamiento", "home.inN": "en {n} proyectos", "home.examples": "Ejemplos y aprendizaje", "home.examplesNote": "Proyectos de ejemplo para probar el programa sin tus datos.", "proj.del": "Eliminar"});
Object.assign(D.en, {"ui.togglePanel": "Hide or show the panel (drag the edge to resize; double click: default width)", "ui.resizeMap": "Drag to resize the map (double click: default size)", "home.tagline": "Core analysis: ichnology, records and intervals", "home.newProject": "New project", "home.search": "Search project or core…", "home.tab.projects": "Projects", "home.tab.all": "All cores", "home.emptyTitle": "No projects yet", "home.emptyText": "A project groups the cores of a study: images, data, age models and intervals. Create one with your data, import a project file (.corantool.json) or learn with the training project (7 fictitious cores and a guided tour).", "home.now": "edited now", "home.min": "edited {n} min ago", "home.hours": "edited {n} h ago", "home.nImg": "{n} images", "home.nVar": "{n} variables", "home.alsoIn": "Also in: {p}", "home.shared": "{n} shared with other projects", "home.noCores": "No cores yet", "home.noMatch": "No project matches the search.", "home.kindTutorial": "training", "home.inN": "in {n} projects", "home.examples": "Examples and learning", "home.examplesNote": "Example projects to try the program without your data.", "proj.del": "Delete"});

let current = 'es';
try { current = localStorage.getItem('ichantool.lang') || (navigator.language || 'es').slice(0, 2); } catch { /* storage blocked */ }
if (!D[current]) current = 'en';

export const lang = () => current;

export function setLang(l) {
  current = D[l] ? l : 'en';
  try { localStorage.setItem('ichantool.lang', current); } catch { /* storage blocked */ }
  document.documentElement.lang = current;
}

/** Text of a formula error thrown by sheet.js (carries key + args) or a plain Error. */
export const fxText = (e) => (e && e.key ? t('fx.' + e.key, e.args) : (e && e.message) || String(e));

export function t(key, vars) {
  // V23: simple plurals — a key 'x.one' is used when vars.n === 1
  const k1 = vars && +vars.n === 1 && (D[current][key + '.one'] ?? D.en[key + '.one']) ? key + '.one' : key;
  let s = D[current][k1] ?? D.en[k1] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  return s;
}

export function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); if (!/[\p{L}\p{N}]/u.test(el.textContent) && !el.querySelector('img[alt]')) el.setAttribute('aria-label', el.title); else el.removeAttribute('aria-label'); });   // V0.39: the visible text stays the accessible name (WCAG 2.5.3)
  root.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  root.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });   // V0.39
  document.documentElement.lang = current;
}

// V24: cross-project analyses live outside the project list
Object.assign(D.es, {
  'home.tab.all': 'Entre proyectos', 'home.all': 'Entre proyectos',
  'home.allNote': 'Todos los sondeos de todos tus proyectos: mapa común, tabla y análisis que combinan sondeos de proyectos distintos. Un sondeo que está en varios proyectos cuenta una sola vez.',
  'mp.title': 'Nuevo análisis entre proyectos', 'mp.saved': 'Análisis entre proyectos guardados', 'mp.label': 'Análisis', 'mp.back': 'Volver al análisis abierto',
  'mp.note': 'Marca en la tabla sondeos de proyectos distintos y crea un análisis. No es un proyecto: guarda una copia de sus datos (sin imágenes), con capas e intervalos unidos por nombre, para usar Multiproxy, Datos y Figuras. Se guarda aquí, no en la lista de proyectos. «Actualizar» vuelve a copiar los datos de los proyectos de origen.',
});
Object.assign(D.en, {
  'home.tab.all': 'Across projects', 'home.all': 'Across projects',
  'home.allNote': 'Every core of every project: common map, table and analyses that combine cores from different projects. A core found in several projects counts once.',
  'mp.title': 'New cross-project analysis', 'mp.saved': 'Saved cross-project analyses', 'mp.label': 'Analysis', 'mp.back': 'Back to the open analysis',
  'mp.note': 'Tick cores of different projects in the table and create an analysis. It is not a project: it keeps a copy of their data (no images), layers and intervals merged by name, for Multiproxy, Data and Figures. It is saved here, not in the project list. “Update” copies the data from the source projects again.',
});

// V25: Multiproxy — clearer panel, hover help, cursor readout, resizable tracks
Object.assign(D.es, {
  'geo.maxGap': 'Hueco máximo (vacío = automático)',
  'gx.import': 'Importar', 'gx.impLong': 'Tabla larga (varios sondeos)', 'gx.impCores': 'Un archivo por sondeo', 'gx.impCat': 'Coordenadas (lat, lon)', 'gx.impIv': 'Intervalos descritos', 'gx.formats': 'Formatos aceptados y datos de demostración',
  'gx.tip.impLong': 'Un solo archivo con una columna «sondeo», una de profundidad o edad y una columna por variable (geoquímica, foraminíferos, TOC…). CSV, TXT o Excel.',
  'gx.tip.impCores': 'Varios archivos, uno por sondeo: profundidad o edad y una columna por variable. El nombre del sondeo sale del nombre del archivo.',
  'gx.tip.impCat': 'Tabla con nombre del sondeo, latitud y longitud (grados decimales). Sitúa los sondeos en el mapa.',
  'gx.tip.impIv': 'Tramos descritos con sondeo, techo, base y clase (litología, turbidita, sapropel…). Son las etiquetas que aprende la clasificación.',
  'gx.tip.demo': 'Carga sondeos sintéticos para probar el modo sin datos propios.',
  'gx.vi': 'Var · Int', 'gx.tip.vi': 'Variables numéricas · intervalos descritos', 'gx.tip.coreDlg': 'Editar o eliminar el sondeo (nombre, unidades, modelo de edad)',
  'gx.tip.axis': 'Eje común en el que se comparan los sondeos. Edad: hace falta modelo de edad en cada sondeo.',
  'gx.tip.step': 'Los registros se remuestrean cada este intervalo (en ka o en la unidad de profundidad). Cada paso es una muestra para el mapa y el modelo.',
  'gx.tip.scaling': 'z-score global: compara valores absolutos entre sondeos. Por sondeo: quita las diferencias de escáner o calibración. Sin escalar: valores originales.',
  'gx.tip.maxGap': 'No se interpola a través de huecos mayores que este. Vacío: 3 veces el espaciado típico de cada registro.',
  'gx.tip.missing': 'Qué hacer si un sondeo no tiene alguna variable: descartar esas muestras o rellenar con la media (permite sondeos con variables distintas).',
  'gx.tip.features': 'Variables que se usan en curvas, mapa y modelo. «log»: usa el logaritmo (para variables muy sesgadas, como cuentas XRF).',
  'gx.tip.ratio': 'Crea una variable nueva como cociente de dos (p. ej. Ti/Ca, Ba/Al).',
  'gx.tip.layer': 'Una capa agrupa intervalos de un mismo tipo (litología, capas orgánicas, turbiditas…). Puede tener una capa madre.',
  'gx.tip.parent': 'Capa de la que depende esta: sus intervalos deben caer dentro de los de la madre.',
  'gx.tip.cats': 'Clases de la capa. Pulsa una para marcarla en las curvas con «Marcar intervalos».',
  'gx.tip.rules': 'Reglas del tipo «Ba/Ti z > 1,5»: etiquetan muestras sin intervalos descritos. No cuentan en la validación.',
  'gx.tip.target': 'Capa que el modelo aprende a reconocer en los sondeos sin describir.',
  'gx.tip.useLayers': 'Otras capas que el modelo puede usar como información (0/1) además de las variables numéricas.',
  'gx.tip.method': 'Bosque aleatorio: robusto, buena opción por defecto. k vecinos: sencillo, sensible a la escala. Bayes ingenuo: rápido con pocos datos. k-medias: agrupa sin etiquetas.',
  'gx.tip.minProb': 'Si la probabilidad de la mejor clase es menor, la muestra queda «sin decidir» en lugar de forzar una clase.',
  'gx.tip.seed': 'Fija el azar del modelo y de la validación para que el resultado sea repetible.',
  'gx.tip.suggest': 'Propone ajustes razonables según el número de muestras y de clases.',
  'gx.tip.train': 'Entrena con las muestras etiquetadas, valida dejando un sondeo fuera (por tramos si solo hay uno) y clasifica todas las muestras.',
  'gx.untrained': 'Sin entrenar', 'gx.trained': '{m} entrenado', 'gx.trainedAcc': '{m}: {a} % de acierto equilibrado', 'gx.noTarget': 'Elige una capa objetivo en el paso 4',
  'gx.nVars': '{n} variables', 'gx.nVars.one': '1 variable', 'gx.nLayers': '{n} capas', 'gx.nLayers.one': '1 capa', 'gx.nIvs': '{n} intervalos', 'gx.nIvs.one': '1 intervalo',
  'gx.tip.core': 'Sondeo que se muestra. ◀ ▶ pasan al anterior o al siguiente.', 'gx.prevCore': 'Sondeo anterior', 'gx.nextCore': 'Sondeo siguiente',
  'gx.tip.mark': 'Activa y arrastra en vertical sobre las curvas para dibujar un intervalo de la clase elegida en el paso 3.',
  'gx.tip.shade': 'Colorea el fondo de las curvas con la clase (descrita, por regla o automática).',
  'gx.trackW': 'Ancho', 'gx.tip.trackW': 'Ancho de todas las columnas de variables. Para una sola columna, arrastra su borde derecho junto al nombre.',
  'gx.trackReset': 'Anchos por defecto', 'gx.tip.trackReset': 'Devuelve todas las columnas a su ancho inicial.',
  'gx.tip.test': 'Clasifica este sondeo con un modelo que no ha visto sus propias etiquetas y compara con lo descrito.',
  'gx.hoverHint': 'Pasa el ratón por las curvas para leer todos los valores a esa profundidad o edad. Arrastra el borde de una columna (junto a su nombre) para ensancharla; doble clic la devuelve a su ancho.',
  'gx.resizeHint': 'Arrastra el borde derecho para cambiar el ancho; doble clic lo restaura.', 'gx.resizeTip': 'Ancho de «{n}»: arrastra · doble clic = por defecto',
  'gx.hitOk': 'acierto', 'gx.hitBad': 'fallo', 'gx.byRule': 'Etiqueta por regla', 'gx.byInterval': 'Etiqueta descrita', 'gx.predicted': 'Clasificación', 'gx.unsure': 'sin decidir',
  'gx.tip.window': 'Ventana de edad que resume el mapa. ◀ ▶ la desplazan su propia anchura.',
  'gx.tip.mapMode': 'Clase dominante: la clase más frecuente en la ventana. Valor: media de una variable en la ventana.',
  'gx.tip.mapFeature': 'Variable que se representa en el mapa.', 'gx.tip.idw': 'Rellena el mapa entre sondeos (solo exploratorio). Opciones en «Interpolación y escala de color».',
  'gx.tip.ref': 'Muestra la diferencia respecto a otra ventana de edad (p. ej. hoy menos el último máximo glacial).', 'gx.tip.mapCsv': 'Descarga los valores de cada sondeo en la ventana.',
  'gx.mapNoData': 'sin datos en la ventana', 'gx.mapN': '{n} muestras',
  'gx.cmOk': '{n} muestras de «{a}» clasificadas bien', 'gx.cmBad': '{n} muestras de «{a}» clasificadas como «{b}»', 'gx.recallTip': 'Se reconoce el {p} % de las muestras de «{a}»',
  'gx.cmTip': 'Filas: clase descrita. Columnas: clase que propone el modelo sin haber visto ese sondeo (o ese tramo).',
  'gx.tip.samples': 'Muestras remuestreadas de todos los sondeos (una por paso).', 'gx.tip.byIv': 'Muestras dentro de un intervalo descrito de la capa objetivo: con ellas se entrena y se valida.',
  'gx.tip.byRule': 'Muestras etiquetadas por reglas: se usan para entrenar pero no para calcular el acierto.',
  'gx.accTip': 'Porcentaje de muestras bien clasificadas. Engaña si una clase domina.', 'gx.baccTip': 'Media del acierto de cada clase: no se infla con la clase mayoritaria. Es la cifra a citar.',
});
Object.assign(D.en, {
  'geo.maxGap': 'Maximum gap (empty = automatic)',
  'gx.import': 'Import', 'gx.impLong': 'Long table (several cores)', 'gx.impCores': 'One file per core', 'gx.impCat': 'Coordinates (lat, lon)', 'gx.impIv': 'Described intervals', 'gx.formats': 'Accepted formats and demo data',
  'gx.tip.impLong': 'One file with a “core” column, a depth or age column and one column per variable (geochemistry, foraminifera, TOC…). CSV, TXT or Excel.',
  'gx.tip.impCores': 'Several files, one per core: depth or age and one column per variable. The core name comes from the file name.',
  'gx.tip.impCat': 'Table with core name, latitude and longitude (decimal degrees). Places the cores on the map.',
  'gx.tip.impIv': 'Described intervals with core, top, base and class (lithology, turbidite, sapropel…). These are the labels the classifier learns.',
  'gx.tip.demo': 'Loads synthetic cores to try this mode without your own data.',
  'gx.vi': 'Var · Int', 'gx.tip.vi': 'Numeric variables · described intervals', 'gx.tip.coreDlg': 'Edit or delete the core (name, units, age model)',
  'gx.tip.axis': 'Common axis on which cores are compared. Age needs an age model in every core.',
  'gx.tip.step': 'Records are resampled at this interval (ka or depth unit). Each step is one sample for the map and the model.',
  'gx.tip.scaling': 'Global z-score: compares absolute values between cores. Per core: removes scanner or calibration offsets. None: original values.',
  'gx.tip.maxGap': 'No interpolation across gaps wider than this. Empty: 3 times the typical spacing of each record.',
  'gx.tip.missing': 'What to do when a core lacks a variable: drop those samples or fill with the mean (allows cores with different variables).',
  'gx.tip.features': 'Variables used by curves, map and model. “log”: use the logarithm (for very skewed variables such as XRF counts).',
  'gx.tip.ratio': 'Creates a new variable as the ratio of two (e.g. Ti/Ca, Ba/Al).',
  'gx.tip.layer': 'A layer groups intervals of one kind (lithology, organic layers, turbidites…). It can have a parent layer.',
  'gx.tip.parent': 'Layer this one depends on: its intervals should fall inside the parent’s.',
  'gx.tip.cats': 'Classes of the layer. Click one to draw it on the curves with “Mark intervals”.',
  'gx.tip.rules': 'Rules such as “Ba/Ti z > 1.5”: label samples without described intervals. Not scored in validation.',
  'gx.tip.target': 'Layer the model learns to recognise in undescribed cores.',
  'gx.tip.useLayers': 'Other layers the model may use as information (0/1) besides the numeric variables.',
  'gx.tip.method': 'Random forest: robust, a good default. k nearest neighbours: simple, scale-sensitive. Naive Bayes: fast with little data. k-means: groups without labels.',
  'gx.tip.minProb': 'If the best class has a lower probability, the sample stays “undecided” instead of forcing a class.',
  'gx.tip.seed': 'Fixes the randomness of the model and validation so results can be repeated.',
  'gx.tip.suggest': 'Proposes sensible settings from the number of samples and classes.',
  'gx.tip.train': 'Trains on labelled samples, validates leaving one core out (by blocks if there is only one) and classifies every sample.',
  'gx.untrained': 'Not trained', 'gx.trained': '{m} trained', 'gx.trainedAcc': '{m}: {a} % balanced accuracy', 'gx.noTarget': 'Choose a target layer in step 4',
  'gx.nVars': '{n} variables', 'gx.nVars.one': '1 variable', 'gx.nLayers': '{n} layers', 'gx.nLayers.one': '1 layer', 'gx.nIvs': '{n} intervals', 'gx.nIvs.one': '1 interval',
  'gx.tip.core': 'Core shown. ◀ ▶ go to the previous or next one.', 'gx.prevCore': 'Previous core', 'gx.nextCore': 'Next core',
  'gx.tip.mark': 'Turn on and drag vertically over the curves to draw an interval of the class chosen in step 3.',
  'gx.tip.shade': 'Colours the background of the curves by class (described, rule or automatic).',
  'gx.trackW': 'Width', 'gx.tip.trackW': 'Width of every variable column. For a single column, drag its right edge next to the name.',
  'gx.trackReset': 'Default widths', 'gx.tip.trackReset': 'Returns every column to its initial width.',
  'gx.tip.test': 'Classifies this core with a model that has not seen its own labels and compares with the description.',
  'gx.hoverHint': 'Hover over the curves to read every value at that depth or age. Drag a column edge (next to its name) to widen it; double click restores it.',
  'gx.resizeHint': 'Drag the right edge to change the width; double click restores it.', 'gx.resizeTip': 'Width of “{n}”: drag · double click = default',
  'gx.hitOk': 'correct', 'gx.hitBad': 'wrong', 'gx.byRule': 'Rule label', 'gx.byInterval': 'Described label', 'gx.predicted': 'Classification', 'gx.unsure': 'undecided',
  'gx.tip.window': 'Age window summarised by the map. ◀ ▶ shift it by its own width.',
  'gx.tip.mapMode': 'Dominant class: most frequent class in the window. Value: mean of a variable in the window.',
  'gx.tip.mapFeature': 'Variable shown on the map.', 'gx.tip.idw': 'Fills the map between cores (exploratory only). Options under “Interpolation and colour scale”.',
  'gx.tip.ref': 'Shows the difference to another age window (e.g. present minus the last glacial maximum).', 'gx.tip.mapCsv': 'Downloads the value of each core in the window.',
  'gx.mapNoData': 'no data in the window', 'gx.mapN': '{n} samples',
  'gx.cmOk': '{n} samples of “{a}” classified correctly', 'gx.cmBad': '{n} samples of “{a}” classified as “{b}”', 'gx.recallTip': '{p} % of the “{a}” samples are recognised',
  'gx.cmTip': 'Rows: described class. Columns: class proposed by the model without having seen that core (or block).',
  'gx.tip.samples': 'Resampled samples of every core (one per step).', 'gx.tip.byIv': 'Samples inside a described interval of the target layer: used to train and validate.',
  'gx.tip.byRule': 'Samples labelled by rules: used for training but not for accuracy.',
  'gx.accTip': 'Share of correctly classified samples. Misleading when one class dominates.', 'gx.baccTip': 'Mean of the per-class accuracy: not inflated by the majority class. The figure to report.',
});

Object.assign(D.es, {
  'gx.tip.markLayer': 'Capa en la que se dibujan los intervalos', 'gx.tip.markCat': 'Clase del intervalo que vas a dibujar',
  'gx.delCat': 'Eliminar esta clase', 'gx.delCatN': '¿Borrar y sus {n} intervalos?', 'gx.tip.catCount': 'Intervalos de esta clase en todos los sondeos',
  'cls.delAsk': '¿Borrar el icnotaxón «{n}»? {t} trazas etiquetadas con él ({e} de ellas ejemplos) y {p} predicciones, en {c} testigos, quedarán sin clasificar. También se borra el historial de deshacer; podrás recuperar el icnotaxón con «Recuperar» mientras el proyecto siga abierto.', 'cls.restore': 'Recuperar «{n}»', 'cls.restored': '«{n}» recuperado: {k} etiquetas y predicciones vuelven a tenerlo.', 'cls.orphans': 'El proyecto tenía {t} trazas y {p} predicciones con un icnotaxón que ya no existe (borrado antes en otro testigo): ahora están sin clasificar.',
  'gx.delCls': 'Eliminar este icnotaxón (sus trazas quedan sin clasificar)', 'gx.fixedCls': 'Clase del programa: no se puede eliminar',
  'gx.noIvHere': 'No hay ningún intervalo a esa altura. Activa «Marcar intervalos» para dibujar uno.', 'gx.clickHint': 'Clic: editar el intervalo de esta altura',
});
Object.assign(D.en, {
  'gx.tip.markLayer': 'Layer in which intervals are drawn', 'gx.tip.markCat': 'Class of the interval you are about to draw',
  'gx.delCat': 'Delete this class', 'gx.delCatN': 'Delete it and its {n} intervals?', 'gx.tip.catCount': 'Intervals of this class in all cores',
  'cls.delAsk': 'Delete the ichnotaxon «{n}»? {t} traces labelled with it ({e} of them examples) and {p} predictions, in {c} cores, will become unclassified. The undo history is cleared too; you can restore the ichnotaxon with «Restore» while the project stays open.', 'cls.restore': 'Restore «{n}»', 'cls.restored': '«{n}» restored: {k} labels and predictions have it again.', 'cls.orphans': 'The project had {t} traces and {p} predictions with an ichnotaxon that no longer exists (deleted earlier in another core): they are now unclassified.',
  'gx.delCls': 'Delete this ichnotaxon (its traces become unclassified)', 'gx.fixedCls': 'Built-in class: cannot be deleted',
  'gx.noIvHere': 'No interval at that level. Turn on “Mark intervals” to draw one.', 'gx.clickHint': 'Click: edit the interval at this level',
});

// V26: user-defined classifiers, neural network, manual classification on the columns
Object.assign(D.es, {
  'geo.s3': 'Familias de intervalos', 'geo.s4': 'Clasificadores automáticos', 'gx.nLayers': '{n} familias', 'gx.nLayers.one': '1 familia',
  'geo.m.name.rf': 'Bosque aleatorio', 'geo.m.name.mlp': 'Red neuronal (perceptrón multicapa)',
  'geo.m.mlp': 'Capas de neuronas que aprenden combinaciones no lineales de los proxies. Necesita más muestras etiquetadas que el bosque aleatorio (cientos) y conviene comparar ambos.',
  'mlp.hidden': 'Neuronas por capa oculta', 'mlp.activation': 'Activación', 'mlp.epochs': 'Épocas máximas', 'mlp.lr': 'Tasa de aprendizaje', 'mlp.l2': 'Regularización L2', 'mlp.batch': 'Tamaño de lote', 'mlp.balanced': 'Equilibrar clases', 'mlp.patience': 'Paciencia (parada temprana)',
  'geo.p.mlp.hidden': '«16» = una capa de 16 neuronas; «32,16» = dos capas. Más neuronas aprenden relaciones más complejas pero se sobreajustan con pocos datos.',
  'geo.p.mlp.activation': 'relu suele aprender más rápido; tanh es más suave.', 'geo.p.mlp.epochs': 'Pasadas completas por los datos de entrenamiento como máximo.',
  'geo.p.mlp.lr': 'Tamaño de cada paso de aprendizaje (Adam). Si el acierto oscila, bájala.', 'geo.p.mlp.l2': 'Penaliza pesos grandes para evitar el sobreajuste.',
  'geo.p.mlp.batch': 'Muestras por paso de aprendizaje.', 'geo.p.mlp.balanced': 'Da el mismo peso total a cada clase aunque unas tengan muchas más muestras.',
  'geo.p.mlp.patience': 'Se reserva el 15 % de las muestras; si su error no mejora en este número de épocas se para y se guardan los mejores pesos.',
  'cl.m.rf': 'Buena opción por defecto: robusto con pocos datos y variables de escalas distintas.', 'cl.m.mlp': 'Red neuronal: capta relaciones complejas; necesita más muestras etiquetadas.',
  'cl.m.knn': 'Clasifica por parecido con las muestras más cercanas. Sencillo y fácil de explicar.', 'cl.m.nb': 'Rápido y estable con muy pocas muestras; supone variables independientes.',
  'cl.m.kmeans': 'No usa etiquetas: agrupa las muestras parecidas para explorar.',
  'cl.intro': 'Un clasificador crea columnas automáticas en todos los sondeos. Tú eliges qué familia (o familias) clasifica, con qué datos aprende y qué modelo usa. Puedes crear varios y compararlos en la pestaña «Clasificadores».',
  'cl.add': '+ Nuevo clasificador', 'cl.dup': 'Duplicar', 'cl.tip.add': 'Crea un clasificador nuevo', 'cl.tip.dup': 'Copia el clasificador seleccionado para probar otro modelo u otras variables',
  'cl.trainAll': 'Entrenar todos', 'cl.tip.trainAll': 'Entrena todos los clasificadores y actualiza sus columnas', 'cl.tab': 'Clasificadores',
  'cl.default': 'Clasificador {n}', 'cl.unnamed': 'sin nombre', 'cl.copyOf': '{n} (copia)', 'cl.name': 'Nombre', 'cl.tip.sel': 'Clic para ver y editar este clasificador',
  'cl.targets': 'Qué clasifica', 'cl.tip.targets': 'Familias que aprende a reconocer. Con varias, entrena un modelo por familia y crea una columna para cada una. El número es el de intervalos descritos.',
  'cl.inputs': 'Con qué datos aprende', 'cl.tip.inputs': 'Variables numéricas (del paso 2) y otras familias que el modelo puede usar como información',
  'cl.inVars': 'Variables: {n} de {m}', 'cl.inFams': 'Otras familias como dato: {n}', 'cl.all': 'Todas', 'cl.none2': 'Ninguna', 'cl.noVars': 'Elige variables en el paso 2.',
  'cl.noOtherFams': 'No hay otras familias con intervalos.', 'cl.famsNote': 'Solo sirven en sondeos donde esa familia esté descrita; en los demás valen 0.', 'cl.noFams': 'Crea una familia en el paso 3.',
  'cl.model': 'Modelo', 'cl.advanced': 'Ajustes del modelo', 'cl.defaults': 'Valores recomendados', 'cl.train': 'Entrenar', 'cl.results': 'Ver resultados',
  'cl.delConfirm': '¿Eliminar?', 'cl.empty': 'No hay clasificadores. Crea uno para generar columnas automáticas.', 'cl.none': 'No hay clasificadores que entrenar.',
  'cl.noInputs': 'sin datos de entrada: elige variables o familias', 'cl.needLabels': 'faltan intervalos descritos de al menos 2 clases',
  'cl.retrainNeeded': 'Pulsa Entrenar', 'cl.changed': 'Cambios sin entrenar', 'cl.stale': 'Datos cambiados: vuelve a entrenar', 'cl.acc': '{a} % acierto equilibrado',
  'cl.res': '{a} % de acierto equilibrado · {n} muestras · {k} clases', 'cl.nClf': '{n} clasificadores', 'cl.nClf.one': '1 clasificador',
  'cl.compare': 'Comparación', 'cl.clf': 'Clasificador', 'cl.family': 'Familia', 'cl.compareNote': 'Validación dejando un sondeo fuera (por tramos si solo hay uno). Pulsa una fila para ver su detalle. Para elegir modelo, duplica un clasificador, cambia el modelo y compara.',
  'cl.mlpInfo': 'red {s}, {e} épocas', 'cl.mapSrc': 'Columna', 'cl.tip.mapSrc': 'Familia descrita o columna automática que se representa', 'cl.mapSub': 'Columna automática «{c}» ({m}).',
  'cl.showEmpty': 'Mostrar todas las familias', 'cl.tip.showEmpty': 'Muestra una columna por familia aunque el sondeo no tenga intervalos, para clasificarlo a mano',
  'cl.hoverHint': 'Arrastra en vertical en la columna de una familia para crear un intervalo y elige su clase; clic en un intervalo para cambiarla o borrarlo. Clic en una columna ⚙ para copiar su clasificación a la familia. Pasa el ratón para leer los valores; arrastra el borde de una columna para ensancharla.',
  'cl.listNote': 'Intervalos de este sondeo por familia. Puedes ajustar los límites y la clase aquí; en cursiva, los pendientes de revisar.',
  'cl.pending': 'Copiado de una columna automática: pendiente de revisar. No se usa para entrenar hasta confirmarlo.', 'cl.noCats': 'Esta familia aún no tiene clases: añade una.',
  'cl.confirm': 'Confirmar', 'cl.delIv': 'Borrar intervalo', 'cl.dragHere': 'Arrastra en vertical en esta columna para crear un intervalo de «{f}».',
  'cl.copyOne': 'Copiar este tramo a «{f}»', 'cl.copyAll': 'Copiar la columna entera a «{f}» (pendiente de revisar)', 'cl.copyNote': 'Lo copiado pasa a ser clasificación manual de este sondeo.',
  'geo.useRules': 'Usar también las reglas', 'gx.tip.train': 'Entrena este clasificador, lo valida dejando un sondeo fuera (por tramos si solo hay uno) y crea sus columnas en todos los sondeos.',
});
Object.assign(D.en, {
  'geo.s3': 'Interval families', 'geo.s4': 'Automatic classifiers', 'gx.nLayers': '{n} families', 'gx.nLayers.one': '1 family',
  'geo.m.name.rf': 'Random forest', 'geo.m.name.mlp': 'Neural network (multilayer perceptron)',
  'geo.m.mlp': 'Layers of neurons that learn non-linear combinations of the proxies. Needs more labelled samples than the random forest (hundreds); compare both.',
  'mlp.hidden': 'Neurons per hidden layer', 'mlp.activation': 'Activation', 'mlp.epochs': 'Maximum epochs', 'mlp.lr': 'Learning rate', 'mlp.l2': 'L2 regularisation', 'mlp.batch': 'Batch size', 'mlp.balanced': 'Balance classes', 'mlp.patience': 'Patience (early stopping)',
  'geo.p.mlp.hidden': '“16” = one layer of 16 neurons; “32,16” = two layers. More neurons learn more complex relations but overfit with little data.',
  'geo.p.mlp.activation': 'relu usually learns faster; tanh is smoother.', 'geo.p.mlp.epochs': 'Maximum number of full passes over the training data.',
  'geo.p.mlp.lr': 'Size of each learning step (Adam). Lower it if accuracy oscillates.', 'geo.p.mlp.l2': 'Penalises large weights to avoid overfitting.',
  'geo.p.mlp.batch': 'Samples per learning step.', 'geo.p.mlp.balanced': 'Gives every class the same total weight even if some have many more samples.',
  'geo.p.mlp.patience': '15 % of the samples are held out; if their error does not improve for this many epochs training stops and the best weights are kept.',
  'cl.m.rf': 'Good default: robust with little data and variables on different scales.', 'cl.m.mlp': 'Neural network: captures complex relations; needs more labelled samples.',
  'cl.m.knn': 'Classifies by similarity to the nearest samples. Simple and easy to explain.', 'cl.m.nb': 'Fast and stable with very few samples; assumes independent variables.',
  'cl.m.kmeans': 'Uses no labels: groups similar samples to explore.',
  'cl.intro': 'A classifier creates automatic columns in every core. You choose which family (or families) it classifies, what it learns from and which model it uses. Create several and compare them in the “Classifiers” tab.',
  'cl.add': '+ New classifier', 'cl.dup': 'Duplicate', 'cl.tip.add': 'Creates a new classifier', 'cl.tip.dup': 'Copies the selected classifier to try another model or other variables',
  'cl.trainAll': 'Train all', 'cl.tip.trainAll': 'Trains every classifier and updates its columns', 'cl.tab': 'Classifiers',
  'cl.default': 'Classifier {n}', 'cl.unnamed': 'unnamed', 'cl.copyOf': '{n} (copy)', 'cl.name': 'Name', 'cl.tip.sel': 'Click to see and edit this classifier',
  'cl.targets': 'What it classifies', 'cl.tip.targets': 'Families it learns to recognise. With several, one model per family and one column each. The number is the count of described intervals.',
  'cl.inputs': 'What it learns from', 'cl.tip.inputs': 'Numeric variables (from step 2) and other families the model may use as information',
  'cl.inVars': 'Variables: {n} of {m}', 'cl.inFams': 'Other families as input: {n}', 'cl.all': 'All', 'cl.none2': 'None', 'cl.noVars': 'Choose variables in step 2.',
  'cl.noOtherFams': 'No other families with intervals.', 'cl.famsNote': 'Only useful in cores where that family is described; elsewhere they are 0.', 'cl.noFams': 'Create a family in step 3.',
  'cl.model': 'Model', 'cl.advanced': 'Model settings', 'cl.defaults': 'Recommended values', 'cl.train': 'Train', 'cl.results': 'See results',
  'cl.delConfirm': 'Delete?', 'cl.empty': 'No classifiers. Create one to generate automatic columns.', 'cl.none': 'No classifiers to train.',
  'cl.noInputs': 'no input data: choose variables or families', 'cl.needLabels': 'needs described intervals of at least 2 classes',
  'cl.retrainNeeded': 'Press Train', 'cl.changed': 'Untrained changes', 'cl.stale': 'Data changed: train again', 'cl.acc': '{a} % balanced accuracy',
  'cl.res': '{a} % balanced accuracy · {n} samples · {k} classes', 'cl.nClf': '{n} classifiers', 'cl.nClf.one': '1 classifier',
  'cl.compare': 'Comparison', 'cl.clf': 'Classifier', 'cl.family': 'Family', 'cl.compareNote': 'Validation leaving one core out (by blocks if there is only one). Click a row for its details. To choose a model, duplicate a classifier, change the model and compare.',
  'cl.mlpInfo': 'network {s}, {e} epochs', 'cl.mapSrc': 'Column', 'cl.tip.mapSrc': 'Described family or automatic column shown', 'cl.mapSub': 'Automatic column “{c}” ({m}).',
  'cl.showEmpty': 'Show every family', 'cl.tip.showEmpty': 'Shows one column per family even if the core has no intervals, to classify it by hand',
  'cl.hoverHint': 'Drag vertically in a family column to create an interval and pick its class; click an interval to change or delete it. Click a ⚙ column to copy its classification to the family. Hover to read values; drag a column edge to widen it.',
  'cl.listNote': 'Intervals of this core by family. Adjust limits and class here; pending ones in italics.',
  'cl.pending': 'Copied from an automatic column: pending review. Not used for training until confirmed.', 'cl.noCats': 'This family has no classes yet: add one.',
  'cl.confirm': 'Confirm', 'cl.delIv': 'Delete interval', 'cl.dragHere': 'Drag vertically in this column to create an interval of “{f}”.',
  'cl.copyOne': 'Copy this segment to “{f}”', 'cl.copyAll': 'Copy the whole column to “{f}” (pending review)', 'cl.copyNote': 'What you copy becomes manual classification of this core.',
  'geo.useRules': 'Also use the rules', 'gx.tip.train': 'Trains this classifier, validates it leaving one core out (by blocks if there is only one) and creates its columns in every core.',
});
Object.assign(D.es, {
  'geo.layer': 'Familia', 'geo.layerName': 'Nombre de la familia', 'geo.layerParent': 'Subdivisión de', 'geo.layerDel': 'Eliminar la familia y sus intervalos', 'geo.noParent': '— (familia principal)',
  'geo.newLayer': 'Nueva familia (p. ej. Periodo climático)', 'geo.addLayer': 'Añadir familia', 'geo.newLayerChild': 'Crearla como subdivisión de la familia actual',
  'geo.cats': 'Clases de la familia', 'geo.newLabel': 'Nueva clase (p. ej. Sapropel)', 'geo.addLabel': 'Añadir clase',
  'gx.resizeClassName': 'Ancho de los nombres: arrastra o usa las flechas. Doble clic o Intro para restablecer.',
  'geo.labelsNote': 'Una familia es un tipo de intervalo con sus clases: periodo frío/cálido; baja oxigenación (sapropel, ORL…); litología… Puede ser subdivisión de otra. Las familias aparecen como columnas en todos los sondeos y se clasifican a mano arrastrando en la columna.',
  'gx.tip.layer': 'Una familia agrupa intervalos de un mismo tipo (periodo climático, baja oxigenación, litología…). Puede subdividir a otra.', 'gx.tip.cats': 'Clases de la familia (p. ej. sapropel, ORL). También se crean desde la propia columna al dibujar un intervalo.',
  'gx.delCat': 'Eliminar esta clase', 'gx.tip.catCount': 'Intervalos de esta clase en todos los sondeos',
});
Object.assign(D.en, {
  'geo.layer': 'Family', 'geo.layerName': 'Family name', 'geo.layerParent': 'Subdivision of', 'geo.layerDel': 'Delete the family and its intervals', 'geo.noParent': '— (main family)',
  'geo.newLayer': 'New family (e.g. Climate period)', 'geo.addLayer': 'Add family', 'geo.newLayerChild': 'Create it as a subdivision of the current family',
  'geo.cats': 'Family classes', 'geo.newLabel': 'New class (e.g. Sapropel)', 'geo.addLabel': 'Add class',
  'gx.resizeClassName': 'Name column width: drag or use the arrow keys. Double-click or press Enter to reset.',
  'geo.labelsNote': 'A family is a type of interval with its classes: cold/warm period; low oxygenation (sapropel, ORL…); lithology… It can subdivide another. Families appear as columns in every core and are classified by hand by dragging in the column.',
  'gx.tip.layer': 'A family groups intervals of one kind (climate period, low oxygenation, lithology…). It can subdivide another.', 'gx.tip.cats': 'Classes of the family (e.g. sapropel, ORL). Can also be created from the column itself when drawing an interval.',
});
Object.assign(D.es, {
  'tip.geo.logs': 'Pulsa «Entrenar todos»: el clasificador aprende las capas orgánicas de 4 sondeos y crea su columna ⚙ en todos. En ENT-02, ENT-05 o ENT-06 (sin describir) arrastra en la columna de una familia para clasificar a mano, o pulsa la columna ⚙ para copiarla.',
  'tip.geo.model': 'Compara los clasificadores en la tabla. Prueba «Duplicar» en el paso 4, elige «Red neuronal» y entrena: verás cuál acierta más dejando un sondeo fuera.',
  'gx.noTarget': 'Elige qué familia clasifica en el paso 4', 'gx.noIvHere': 'No hay ningún intervalo a esa altura. Arrastra en la columna de una familia para crear uno.',
  'geo.howto': '<ol style="margin:0;padding-left:18px;display:grid;gap:4px"><li><b>Sondeos y datos.</b> Importa registros numéricos (geoquímica, foraminíferos, TOC…) en profundidad o edad y la posición de cada sondeo. En «Curvas» ves el compuesto de cada sondeo.</li><li><b>Variables.</b> Elige qué registros se usan; se remuestrean a una malla común (p. ej. cada 0,5 ka).</li><li><b>Familias de intervalos.</b> Define tipos de intervalo con sus clases: periodo frío/cálido; baja oxigenación (sapropel, ORL…). Cada familia es una columna en todos los sondeos: arrastra en ella para clasificar a mano, aunque el sondeo no la tuviera.</li><li><b>Clasificadores.</b> Crea uno o varios: qué familia clasifican, con qué variables y con qué modelo (bosque aleatorio, red neuronal…). Cada uno añade una columna ⚙ en todos los sondeos; compáralos en «Clasificadores».</li></ol>',
});
Object.assign(D.en, {
  'tip.geo.logs': 'Press “Train all”: the classifier learns the organic layers of 4 cores and adds its ⚙ column to every core. In ENT-02, ENT-05 or ENT-06 drag in a family column to classify by hand, or click the ⚙ column to copy it.',
  'tip.geo.model': 'Compare the classifiers in the table. Try “Duplicate” in step 4, choose “Neural network” and train.',
  'gx.noTarget': 'Choose what it classifies in step 4', 'gx.noIvHere': 'No interval at that level. Drag in a family column to create one.',
  'geo.howto': '<ol style="margin:0;padding-left:18px;display:grid;gap:4px"><li><b>Cores and data.</b> Import numeric records (geochemistry, foraminifera, TOC…) in depth or age and each core’s position. “Curves” shows each core’s composite.</li><li><b>Variables.</b> Choose the records used; they are resampled to a common grid (e.g. every 0.5 ka).</li><li><b>Interval families.</b> Define interval types with their classes: cold/warm period; low oxygenation (sapropel, ORL…). Each family is a column in every core: drag in it to classify by hand, even where the core had none.</li><li><b>Classifiers.</b> Create one or more: which family they classify, from which variables and with which model (random forest, neural network…). Each adds a ⚙ column to every core; compare them under “Classifiers”.</li></ol>',
});
Object.assign(D.es, { 'geo.modelIntro': 'Familia que clasifica: «{l}». Aprende de {v} variables numéricas y {c} columnas 0/1 de otras familias.' });
Object.assign(D.en, { 'geo.modelIntro': 'Family classified: “{l}”. Learns from {v} numeric variables and {c} 0/1 columns of other families.' });

// V27: training progress and version tag
Object.assign(D.es, {
  'cl.cancel': 'Cancelar', 'cl.busy': 'Ya se está entrenando: espera o cancela.', 'cl.cancelled': 'Entrenamiento cancelado: se mantienen los modelos anteriores.',
  'cl.pFit': 'Entrenando «{c}» · {f}', 'cl.pFold': '«{c}» · {f}: validación {k} de {n}', 'cl.eta': 'quedan ≈ {s} s', 'cl.doneIn': 'Entrenado en {s} s',
  'ver.tip': 'Versión (entrega) del programa. Compárala con el nombre del archivo descargado.',
});
Object.assign(D.en, {
  'cl.cancel': 'Cancel', 'cl.busy': 'Training already running: wait or cancel.', 'cl.cancelled': 'Training cancelled: previous models kept.',
  'cl.pFit': 'Training “{c}” · {f}', 'cl.pFold': '“{c}” · {f}: validation {k} of {n}', 'cl.eta': '≈ {s} s left', 'cl.doneIn': 'Trained in {s} s',
  'ver.tip': 'Program version (delivery). Compare it with the name of the downloaded file.',
});

Object.assign(D.es, { 'cl.pEpoch': 'época {e}/{n}' });
Object.assign(D.en, { 'cl.pEpoch': 'epoch {e}/{n}' });

// V31: crop, Start/End markers, hide excluded zones
Object.assign(D.es, {
  'crop.btn': '✂ Recortar', 'crop.tip': 'Quita franjas de arriba o abajo de la imagen (escalas, etiquetas) que no son sondeo',
  'crop.title': 'Recortar la imagen', 'crop.help': 'Arrastra las líneas rojas «Crop top» y «Crop bottom» (o sus triángulos) hasta el borde del sondeo. Lo sombreado se elimina.',
  'crop.adjust': 'Las profundidades eran de la imagen completa: recalcularlas', 'crop.keep': 'Las profundidades ya son las del sondeo: mantenerlas',
  'crop.info': 'Quedan {h} de {H} px · profundidad {a}–{b} {u}', 'crop.apply': 'Recortar', 'crop.cancel': 'No recortar',
  'crop.small': 'Deja al menos 10 px de imagen.', 'crop.done': 'Imagen recortada: {a}–{b} {u}',
  'roi.title': 'Área de análisis (triángulos Start y End a la izquierda de la imagen)',
  'log.hideExcl': 'Ocultar zonas excluidas', 'log.hideExclTip': 'Las zonas marcadas con «Excluir» salen en blanco en la imagen de la columna',
});
Object.assign(D.en, {
  'crop.btn': '✂ Crop', 'crop.tip': 'Removes strips at the top or bottom of the image (scales, labels) that are not core',
  'crop.title': 'Crop the image', 'crop.help': 'Drag the red “Crop top” and “Crop bottom” lines (or their triangles) to the edge of the core. The shaded part is removed.',
  'crop.adjust': 'Depths were for the whole image: recalculate them', 'crop.keep': 'Depths are already the core’s: keep them',
  'crop.info': '{h} of {H} px remain · depth {a}–{b} {u}', 'crop.apply': 'Crop', 'crop.cancel': 'Do not crop',
  'crop.small': 'Keep at least 10 px of image.', 'crop.done': 'Image cropped: {a}–{b} {u}',
  'roi.title': 'Analysis area (Start and End triangles left of the image)',
  'log.hideExcl': 'Hide excluded zones', 'log.hideExclTip': 'Zones marked with “Exclude” are left blank in the column image',
});

// V32: identification mode, legends, section and range figures
Object.assign(D.es, {
  'tool.mark': 'Marcar traza identificada (M): clic = marca del icnotaxón activo; clic sobre una marca o Alt+clic = quitarla',
  'id.mode': 'Modo identificación', 'id.tip': 'Para sondeos donde no se puede cuantificar la bioturbación: solo se marcan las trazas que se reconocen. La columna muestra triángulos en su posición y la lista de icnotaxones por tramo, sin porcentajes ni BI/ii.',
  'id.on': 'Modo identificación: elige un icnotaxón y haz clic sobre cada traza que reconozcas.', 'id.off': 'Modo cuantificación: vuelven los porcentajes y los índices.',
  'id.pickCls': 'Elige primero un icnotaxón en la lista.', 'id.count': '{n} marcas', 'id.marks': 'Trazas', 'id.list': 'Icnotaxones identificados',
  'id.subtitle': 'Modo identificación · {n} trazas marcadas · ventana {from}–{to} {u}',
  'fig.t.sections': 'Secciones del sondeo (paneles lado a lado)', 'fig.t.range': 'Distribución de icnotaxones',
  'fig.p.orig': 'Original', 'fig.p.enh': 'Tratada', 'fig.p.fill': 'Trazas coloreadas', 'fig.p.alpha': 'Trazas con transparencia', 'fig.p.outline': 'Contornos',
  'fig.p.mask': 'Solo trazas', 'fig.p.bw': 'Trazas en negro', 'fig.p.arrows': 'Flechas e icnotaxones',
  'fig.from': 'Desde', 'fig.to': 'Hasta', 'fig.auto2': 'todo', 'fig.panelW': 'Ancho de panel (px)', 'fig.panelH': 'Alto (px)', 'fig.panels': 'Versiones del sondeo',
  'fig.alpha': 'Opacidad de las trazas', 'fig.minArea': 'Flechas: tamaño mínimo (px)', 'fig.minAreaTip': 'Solo se señalan con flecha las trazas de al menos este área (más las marcas del modo identificación)',
  'fig.secNote': 'Figura habitual en artículos de icnología de sondeos: el mismo tramo original, tratado y con las trazas resaltadas por icnotaxón. Deja «Desde» y «Hasta» vacíos para todo el sondeo; para una figura nítida, elige un tramo corto.',
  'fig.rangeNote': 'Una columna por icnotaxón: barras proporcionales a su porcentaje en cada intervalo (escala propia) o triángulos donde se identificó (modo identificación).',
  'fig.rangeSub': 'Abundancia relativa por intervalo (cada columna escalada a su máximo)', 'fig.rangeSubId': 'Presencia de icnotaxones identificados por intervalo',
});
Object.assign(D.en, {
  'tool.mark': 'Mark identified trace (M): click = mark of the active ichnotaxon; click a mark or Alt+click = remove it',
  'id.mode': 'Identification mode', 'id.tip': 'For cores where bioturbation cannot be quantified: only the traces you recognise are marked. The column shows triangles at their position and the ichnotaxa per interval, without percentages or BI/ii.',
  'id.on': 'Identification mode: choose an ichnotaxon and click each trace you recognise.', 'id.off': 'Quantification mode: percentages and indices are back.',
  'id.pickCls': 'Choose an ichnotaxon in the list first.', 'id.count': '{n} marks', 'id.marks': 'Traces', 'id.list': 'Identified ichnotaxa',
  'id.subtitle': 'Identification mode · {n} traces marked · window {from}–{to} {u}',
  'fig.t.sections': 'Core sections (panels side by side)', 'fig.t.range': 'Ichnotaxa distribution',
  'fig.p.orig': 'Original', 'fig.p.enh': 'Treated', 'fig.p.fill': 'Coloured traces', 'fig.p.alpha': 'Traces with transparency', 'fig.p.outline': 'Outlines',
  'fig.p.mask': 'Traces only', 'fig.p.bw': 'Traces in black', 'fig.p.arrows': 'Arrows and ichnotaxa',
  'fig.from': 'From', 'fig.to': 'To', 'fig.auto2': 'all', 'fig.panelW': 'Panel width (px)', 'fig.panelH': 'Height (px)', 'fig.panels': 'Core versions',
  'fig.alpha': 'Trace opacity', 'fig.minArea': 'Arrows: minimum size (px)', 'fig.minAreaTip': 'Only traces of at least this area get an arrow (plus identification-mode marks)',
  'fig.secNote': 'Common figure in core ichnology papers: the same interval original, treated and with traces highlighted by ichnotaxon. Leave From/To empty for the whole core; pick a short interval for a sharp figure.',
  'fig.rangeNote': 'One column per ichnotaxon: bars proportional to its percentage per interval (own scale) or triangles where it was identified (identification mode).',
  'fig.rangeSub': 'Relative abundance per interval (each column scaled to its maximum)', 'fig.rangeSubId': 'Presence of identified ichnotaxa per interval',
});

/* V0.1: images on disk, working resolution per section, interval in cm */
Object.assign(D.es, {
  'a.bin': 'Intervalo de análisis (cm)', 'a.binNote': '≈ {n} filas de píxeles en esta sección ({p} px/cm) · {m} datos', 'a.binMin': 'Por debajo de 1 píxel se usa 1 fila.',
  'log.subtitle': '{n} secciones · intervalos de {b} cm · ventana {from}–{to} {u}',
  'mem.loading': 'Cargando la imagen desde el disco…', 'err.imgMissing': 'No se encuentra la imagen original de «{n}».',
  'tiles.building': 'Preparando «{n}» para verla a resolución completa', 'tiles.stage.hash': 'Comprobando el archivo…', 'tiles.stage.level0': 'Cortando la imagen en piezas…',
  'tiles.stage.levels': 'Preparando las vistas reducidas…', 'tiles.cancelled': 'Cancelado: la imagen no se ha añadido.',
  'tiles.added': 'Imagen grande ({w} × {h} px) añadida por piezas: se ve a resolución completa al acercar el zoom. En esta versión de prueba todavía no se guarda en el proyecto ni se puede editar ni analizar.',
  'tiles.frozen.engine': 'Esta sección grande necesita el programa de escritorio con el motor activado: aquí se muestra sin su imagen ni sus máscaras y se conserva tal cual.',
  'tiles.frozen.source': 'No se encuentra la imagen original de esta sección grande: sus máscaras y su tabla se conservan, pero no se puede editar hasta localizarla.',
  'tiles.unsaved': 'Las últimas ediciones de una sección grande aún no han llegado al almacén del motor: el resto del proyecto se ha guardado y se volverá a intentar.',
  'tiles.stage.masks': 'Leyendo las máscaras…',
  'tiles.frozen.store': 'Faltan o están dañadas las máscaras guardadas de esta sección grande: se muestra sin ellas y se conserva tal como se guardó.',
  'tiles.storeMissing': 'Faltan o están dañadas las máscaras guardadas de la sección «{s}»: se abre sin ellas, bloqueada, y se conserva tal como se guardó.',
  'tiles.deleteFailed': 'El proyecto se ha borrado, pero no la carpeta de sus máscaras de secciones grandes en este ordenador.',
  'tiles.copyNeedsEngine': 'La versión local tiene secciones grandes: para conservarla como copia hace falta el programa de escritorio con el motor activado.',
  'tiles.copyingProject': 'Conservando una copia de «{n}» con sus secciones grandes',
  'tiles.waiting': 'Calculando primero los objetos afectados de esta sección grande… (Esc cancela)',
  'tiles.stage.copy': 'Copiando y comprobando la imagen…', 'tiles.locating': 'Comprobando que «{n}» es la imagen original',
  'tiles.copying': 'Copiando «{n}» al proyecto', 'tiles.source.title': 'Imagen original',
  'tiles.source.copied': 'El proyecto guarda su propia copia de la imagen original ({s}).',
  'tiles.source.original': 'La imagen original ({s}) sigue en su sitio. El proyecto depende de ella; puedes guardar una copia dentro del proyecto.',
  'tiles.source.cached': 'La imagen original ({s}) ya no está donde estaba. La sección se ve gracias a las vistas guardadas en este ordenador, que pueden borrarse para liberar espacio: localízala.',
  'tiles.source.missing': 'No se encuentra la imagen original ({s}). Localízala para volver a editar la sección.',
  'tiles.source.unknown': 'No se ha podido comprobar dónde está la imagen original.',
  'tiles.source.locate': 'Localizar la imagen…', 'tiles.source.copy': 'Copiar la imagen al proyecto',
  'tiles.source.notSame': 'Ese archivo no es la imagen original de esta sección ({a}; la original ocupa {b}): no se ha usado.',
  'tiles.source.located': 'Imagen original encontrada.',
  'tiles.source.copyAsk': 'Se copiará la imagen original ({s}) dentro del proyecto, en este ordenador. Espacio libre: {f}. ¿Continuar?',
  'tiles.source.copyDone': 'La imagen original está copiada en el proyecto.',
  'tiles.countLimit': 'Esta sección grande tiene tantas trazas que su tabla de intervalos no cabe en la memoria reservada para contarla; se muestra vacía.',
  'tiles.countErr': 'No se pudo contar una pieza de la sección grande ({m}). La tabla de intervalos se completará al reintentarlo.',
  'tiles.unavailable': 'Esta herramienta todavía no funciona con secciones grandes por piezas.', 'tiles.zoomIn': 'Acércate más para editar esta sección grande: a esta distancia habría que cargar demasiadas piezas de máscara.', 'tiles.loadingMasks': 'Cargando las máscaras de esta zona; vuelve a intentarlo en un momento.', 'tiles.masksUnsent': 'Las últimas máscaras de la sección grande no han llegado al almacén del motor. Se conservan en esta ventana y se enviarán de nuevo en cuanto el motor responda.', 'tiles.masksSent': 'Las máscaras de la sección grande ya están en el almacén del motor.', 'tiles.undoTrimmed': 'Se han descartado los pasos más antiguos de «Deshacer»: las copias de las máscaras de la sección grande superaban 64 MiB.', 'tiles.busy': 'Se están calculando los objetos de esta sección grande; vuelve a intentarlo en un momento.', 'tiles.storeLimit': 'Esta sección grande supera un límite del almacén del motor ({field}: {n}). Sus máscaras se conservan en esta ventana pero no se guardan en el almacén hasta que baje de ese límite.', 'tiles.boxTooLarge': 'Este objeto es demasiado grande para editarlo de una vez en una sección grande (su recuadro ocupa más de {n} piezas de máscara).', 'tiles.err': 'No se pudo preparar la imagen grande ({code} {field}).',
  'sec.res': 'Resolución de esta sección', 'sec.resFull': 'Completa', 'sec.resTooBig': 'no cabe en memoria',
  'sec.resRefused': 'Esa resolución necesita unos {gb} GB de memoria y la ventana podría quedarse en blanco. Elige una menor.',
  'sec.reducedToFit': 'La imagen se ha reducido a 1/{k}: sin reducir necesitaría unos {gb} GB de memoria. El archivo original se guarda completo.', 'sec.resUnknown': '1/{k} (se conocerá al abrir la imagen)',
  'sec.resNote': 'El archivo original se guarda completo. Al cambiar la resolución se recalcula la imagen y las máscaras se adaptan; al reducirla pueden desaparecer trazas muy pequeñas. Memoria de esta sección: ~{mb} MB; las resoluciones que no caben en memoria aparecen desactivadas. Las imágenes nuevas se añaden con el «Tamaño máximo al añadir imágenes» de los ajustes.',
  'sec.resAll': 'Igualar todas las secciones a esta resolución (px/cm)', 'sec.resAllDone': 'Secciones ajustadas a ≈ {p} px/cm',
  'sec.maxMPNote': 'Las imágenes más grandes se reducen al añadirlas, para trabajar con fluidez. El archivo original se guarda completo: después puedes cambiar la resolución de cada sección en «Resolución de esta sección».',
});
Object.assign(D.en, {
  'a.bin': 'Analysis interval (cm)', 'a.binNote': '≈ {n} pixel rows in this section ({p} px/cm) · {m} data points', 'a.binMin': 'Below 1 pixel, 1 row is used.',
  'log.subtitle': '{n} sections · {b} cm intervals · window {from}–{to} {u}',
  'mem.loading': 'Loading the image from disk…', 'err.imgMissing': 'The original image of “{n}” is missing.',
  'tiles.building': 'Preparing «{n}» to be seen at full resolution', 'tiles.stage.hash': 'Checking the file…', 'tiles.stage.level0': 'Cutting the image into tiles…',
  'tiles.stage.levels': 'Preparing the reduced views…', 'tiles.cancelled': 'Cancelled: the image was not added.',
  'tiles.added': 'Large image ({w} × {h} px) added as tiles: zoom in to see it at full resolution. In this trial version it is not saved in the project yet and cannot be edited or analysed.',
  'tiles.frozen.engine': 'This large section needs the desktop program with the engine on: here it is shown without its image or masks and is kept as it is.',
  'tiles.frozen.source': 'The original image of this large section cannot be found: its masks and table are kept, but it cannot be edited until the image is located.',
  'tiles.unsaved': 'The latest edits of a large section have not reached the engine\'s store yet: the rest of the project was saved and it will be tried again.',
  'tiles.stage.masks': 'Reading the masks…',
  'tiles.frozen.store': 'The stored masks of this large section are missing or damaged: it is shown without them and kept as it was saved.',
  'tiles.storeMissing': 'The stored masks of the section «{s}» are missing or damaged: it opens without them, locked, and is kept as it was saved.',
  'tiles.deleteFailed': 'The project was deleted, but not the folder of its large sections\' masks on this computer.',
  'tiles.copyNeedsEngine': 'The local version has large sections: keeping it as a copy needs the desktop program with the engine on.',
  'tiles.copyingProject': 'Keeping a copy of «{n}» with its large sections',
  'tiles.waiting': 'Computing the objects concerned in this large section first… (Esc cancels)',
  'tiles.stage.copy': 'Copying and checking the image…', 'tiles.locating': 'Checking that «{n}» is the original image',
  'tiles.copying': 'Copying «{n}» into the project', 'tiles.source.title': 'Original image',
  'tiles.source.copied': 'The project keeps its own copy of the original image ({s}).',
  'tiles.source.original': 'The original image ({s}) is still in its place. The project depends on it; you can keep a copy inside the project.',
  'tiles.source.cached': 'The original image ({s}) is no longer where it was. The section is shown from views stored on this computer, which may be deleted to free space: locate it.',
  'tiles.source.missing': 'The original image ({s}) cannot be found. Locate it to edit the section again.',
  'tiles.source.unknown': 'Where the original image is could not be checked.',
  'tiles.source.locate': 'Locate the image…', 'tiles.source.copy': 'Copy the image into the project',
  'tiles.source.notSame': 'That file is not the original image of this section ({a}; the original is {b}): it was not used.',
  'tiles.source.located': 'Original image found.',
  'tiles.source.copyAsk': 'The original image ({s}) will be copied inside the project, on this computer. Free space: {f}. Continue?',
  'tiles.source.copyDone': 'The original image is copied into the project.',
  'tiles.countLimit': 'This large section has so many traces that its interval table does not fit in the memory set aside for counting it; it is shown empty.',
  'tiles.countErr': 'A tile of the large section could not be counted ({m}). The interval table will complete when it is tried again.',
  'tiles.unavailable': 'This tool does not work with large tiled sections yet.', 'tiles.zoomIn': 'Zoom in to edit this large section: at this distance too many mask tiles would have to be loaded.', 'tiles.loadingMasks': 'Loading the masks of this area; try again in a moment.', 'tiles.masksUnsent': 'The latest masks of the large section did not reach the engine\'s store. They are kept in this window and will be sent again as soon as the engine answers.', 'tiles.masksSent': 'The masks of the large section are now in the engine\'s store.', 'tiles.undoTrimmed': 'The oldest Undo steps were dropped: the copies of the large section\'s masks exceeded 64 MiB.', 'tiles.busy': 'The objects of this large section are being computed; try again in a moment.', 'tiles.storeLimit': 'This large section exceeds a limit of the engine\'s store ({field}: {n}). Its masks are kept in this window but are not stored until it is below that limit.', 'tiles.boxTooLarge': 'This object is too large to edit at once in a large section (its box covers more than {n} mask tiles).', 'tiles.err': 'The large image could not be prepared ({code} {field}).',
  'sec.res': 'Resolution of this section', 'sec.resFull': 'Full', 'sec.resTooBig': 'does not fit in memory',
  'sec.resRefused': 'That resolution needs about {gb} GB of memory and the window could go blank. Choose a lower one.',
  'sec.reducedToFit': 'The image was reduced to 1/{k}: without reduction it would need about {gb} GB of memory. The original file is kept at full resolution.', 'sec.resUnknown': '1/{k} (known once the image is opened)',
  'sec.resNote': 'The original file is kept at full resolution. Changing the resolution recomputes the image and adapts the masks; reducing it may remove very small traces. Memory for this section: ~{mb} MB; resolutions that do not fit in memory are disabled. New images are added with the «Maximum size when adding images» of the settings.',
  'sec.resAll': 'Set all sections to this resolution (px/cm)', 'sec.resAllDone': 'Sections set to ≈ {p} px/cm',
  'sec.maxMPNote': 'Larger images are reduced when they are added, so that work stays fluid. The original file is kept at full resolution: you can change the resolution of each section later in «Resolution of this section».',
});

/* V0.2 */
Object.assign(D.es, { 'err.import': 'No se pudo importar «{f}»: {m}', 'top.lang': 'Cambiar idioma (English / Español)' });
Object.assign(D.en, { 'err.import': 'Could not import “{f}”: {m}', 'top.lang': 'Switch language (English / Español)' });

/* V0.2: hide ichnotaxa while interpreting; figure options */
Object.assign(D.es, { 'cls.hide': 'Ocultar este icnotaxón en la imagen (no se borra)', 'cls.show': 'Mostrar este icnotaxón', 'cls.solo': 'Ver solo el activo', 'cls.soloTip': 'Oculta en la imagen los demás icnotaxones para interpretar sin que molesten. No se borra nada ni cambia el análisis.', 'cls.showAll': 'Mostrar todos',
  'fig.tracks': 'Columnas', 'fig.recs': 'Otros registros', 'fig.coreImgW': 'Ancho del testigo (px)',
  'fig.compositionReset': 'Restablecer la presentación heredada', 'fig.compositionNote': 'Estas opciones pertenecen a este tipo de figura y pestaña. No modifican la vista de análisis.', 'fig.overlayOpacity': 'Opacidad de la superposición (0,35–1)' });
Object.assign(D.en, { 'cls.hide': 'Hide this ichnotaxon in the image (not deleted)', 'cls.show': 'Show this ichnotaxon', 'cls.solo': 'Show active only', 'cls.soloTip': 'Hides the other ichnotaxa in the image so they do not get in the way. Nothing is deleted and the analysis does not change.', 'cls.showAll': 'Show all',
  'fig.tracks': 'Columns', 'fig.recs': 'Other records', 'fig.coreImgW': 'Core width (px)',
  'fig.compositionReset': 'Restore inherited presentation', 'fig.compositionNote': 'These options belong to this figure type and tab. They do not change the analysis view.', 'fig.overlayOpacity': 'Overlay opacity (0.35–1)' });
Object.assign(D.es, { 'sec.needProject': 'Primero crea o abre un proyecto: las imágenes se guardan siempre dentro de un proyecto y de un sondeo.', 'sec.pickCoreTitle': 'Añadir {n} imagen(es)', 'sec.pickCore': '¿A qué sondeo pertenecen?', 'sec.newCore': 'Nuevo sondeo…', 'sec.newCoreName': 'Nombre del nuevo sondeo', 'sec.addHere': 'Añadir' });
Object.assign(D.en, { 'sec.needProject': 'Create or open a project first: images are always kept inside a project and a core.', 'sec.pickCoreTitle': 'Add {n} image(s)', 'sec.pickCore': 'Which core do they belong to?', 'sec.newCore': 'New core…', 'sec.newCoreName': 'Name of the new core', 'sec.addHere': 'Add' });
Object.assign(D.es, { 'fig.rangeSubBoth': 'Abundancia relativa por intervalo (barras) e icnotaxones identificados (triángulos)' });
Object.assign(D.en, { 'fig.rangeSubBoth': 'Relative abundance per interval (bars) and identified ichnotaxa (triangles)' });

/* V0.3: no data */
Object.assign(D.es, { 'log.noData': 'SIN DATOS', 'a.minValid': 'Mínimo de píxeles válidos por intervalo (%)', 'a.minValidTip': 'Un intervalo con menos píxeles válidos (no excluidos) que este porcentaje no tiene datos: aparece como SIN DATOS, no como 0.', 'log.noDataPad': 'Ampliar zonas sin datos (cm por lado)', 'log.noDataPadTip': 'Marca también como sin datos los intervalos que estén a menos de esta distancia de una zona sin datos (para casos dudosos en los bordes de zonas excluidas).' });
Object.assign(D.en, { 'log.noData': 'NO DATA', 'a.minValid': 'Minimum valid pixels per interval (%)', 'a.minValidTip': 'An interval with fewer valid (not excluded) pixels than this percentage has no data: it is shown as NO DATA, not as 0.', 'log.noDataPad': 'Widen no-data zones (cm per side)', 'log.noDataPadTip': 'Also mark as no data the intervals closer than this distance to a no-data zone (for doubtful cases at the edges of excluded zones).' });

/* V0.5: column style */
Object.assign(D.es, { 'st.title': 'Estilo de la columna y su figura', 'st.yUnit': 'Unidades del eje (profundidad)', 'st.yUnitAge': 'Unidades del eje (edad)', 'st.native': 'Las del sondeo', 'st.yStep': 'Intervalo de las marcas del eje', 'st.yDiv': 'Nº de divisiones del eje (aprox.)', 'st.pctDiv': 'Divisiones de los ejes de %', 'st.fontSize': 'Tamaño de letra', 'st.totalStyle': 'Forma de la bioturbación', 'st.ts.barsline': 'Barras y línea', 'st.ts.bars': 'Barras', 'st.ts.line': 'Línea', 'st.ts.points': 'Puntos', 'st.colors': 'Colores (barras, línea)', 'st.totalTitle': 'Título columna bioturbación', 'st.speciesTitle': 'Título columna icnotaxones', 'st.frame': 'Marco de las columnas', 'st.grid': 'Líneas de rejilla', 'st.boundaries': 'Límites de sección', 'st.showTitle': 'Título y subtítulo' });
Object.assign(D.en, { 'st.title': 'Style of the column and its figure', 'st.yUnit': 'Axis units (depth)', 'st.yUnitAge': 'Axis units (age)', 'st.native': 'Core units', 'st.yStep': 'Axis tick interval', 'st.yDiv': 'No. of axis divisions (approx.)', 'st.pctDiv': 'Divisions of % axes', 'st.fontSize': 'Font size', 'st.totalStyle': 'Bioturbation shape', 'st.ts.barsline': 'Bars and line', 'st.ts.bars': 'Bars', 'st.ts.line': 'Line', 'st.ts.points': 'Points', 'st.colors': 'Colours (bars, line)', 'st.totalTitle': 'Bioturbation column title', 'st.speciesTitle': 'Ichnotaxa column title', 'st.frame': 'Column frames', 'st.grid': 'Grid lines', 'st.boundaries': 'Section boundaries', 'st.showTitle': 'Title and subtitle' });
Object.assign(D.es, { 'fig.markStyle': 'Indicador de las trazas (flechas)', 'fig.ms.arrowLabel': 'Flecha y abreviatura', 'fig.ms.arrow': 'Solo flecha', 'fig.ms.triDown': 'Triángulo invertido', 'fig.ms.tri': 'Triángulo', 'fig.ms.circle': 'Círculo', 'fig.ms.square': 'Cuadrado', 'fig.ms.star': 'Estrella', 'fig.ms.cross': 'Aspa', 'fig.overlap': 'Etiquetas que se tocan', 'fig.ov.keep': 'Dejarlas', 'fig.ov.shift': 'Desplazarlas hacia abajo', 'fig.ov.merge': 'Unirlas en una (Ch, Pl)', 'fig.ov.hide': 'Ocultar la de abajo' });
Object.assign(D.en, { 'fig.markStyle': 'Trace marker (arrows)', 'fig.ms.arrowLabel': 'Arrow and abbreviation', 'fig.ms.arrow': 'Arrow only', 'fig.ms.triDown': 'Inverted triangle', 'fig.ms.tri': 'Triangle', 'fig.ms.circle': 'Circle', 'fig.ms.square': 'Square', 'fig.ms.star': 'Star', 'fig.ms.cross': 'Cross', 'fig.overlap': 'Labels that touch', 'fig.ov.keep': 'Leave them', 'fig.ov.shift': 'Shift them down', 'fig.ov.merge': 'Merge into one (Ch, Pl)', 'fig.ov.hide': 'Hide the lower one' });
Object.assign(D.es, { 'st.axes': 'Columnas a la derecha del testigo: ancho y ejes', 'st.ax.w': 'Ancho', 'st.ax.min': 'Mín', 'st.ax.max': 'Máx', 'st.ax.div': 'Div.', 'st.ax.dec': 'Dec.', 'st.ax.revTip': 'Invertir el eje', 'st.ax.logTip': 'Escala logarítmica (valores > 0)', 'st.axesNote': 'Vacío = automático. Ancho en px (también se cambia arrastrando el borde de la columna). Div. = número de divisiones del eje; Dec. = decimales de las etiquetas.' });
Object.assign(D.en, { 'st.axes': 'Columns at the right of the core: width and axes', 'st.ax.w': 'Width', 'st.ax.min': 'Min', 'st.ax.max': 'Max', 'st.ax.div': 'Div.', 'st.ax.dec': 'Dec.', 'st.ax.revTip': 'Invert axis', 'st.ax.logTip': 'Logarithmic scale (values > 0)', 'st.axesNote': 'Empty = automatic. Width in px (can also be changed by dragging the column edge). Div. = number of axis divisions; Dec. = decimals of the labels.' });
Object.assign(D.es, { 'fig.tviews': 'Versiones de cada traza (una al lado de otra)', 'fig.tv.enh': 'Tratada', 'fig.tv.enhOut': 'Tratada con contorno', 'fig.tv.orig': 'Original', 'fig.tv.origOut': 'Original con contorno', 'fig.tv.iso': 'Solo la traza', 'fig.tv.isoEnh': 'Solo la traza (tratada)', 'fig.tv.isoOut': 'Solo la traza con contorno', 'fig.tv.mask': 'Silueta en color', 'fig.tv.outline': 'Solo contorno',
  'fig.sc.style': 'Escala', 'fig.sc.bar': 'Barra', 'fig.sc.ticks': 'Barra con divisiones', 'fig.sc.line': 'Línea con topes', 'fig.sc.none': 'Sin escala', 'fig.sc.pos': 'Posición de la escala', 'fig.sc.p.bl': 'Abajo a la izquierda', 'fig.sc.p.br': 'Abajo a la derecha', 'fig.sc.p.tl': 'Arriba a la izquierda', 'fig.sc.p.tr': 'Arriba a la derecha', 'fig.sc.len': 'Longitud (cm)', 'fig.sc.div': 'Divisiones', 'fig.sc.colors': 'Colores (relleno, borde)', 'fig.sc.all': 'Escala en todas las versiones' });
Object.assign(D.en, { 'fig.tviews': 'Versions of each trace (side by side)', 'fig.tv.enh': 'Treated', 'fig.tv.enhOut': 'Treated with outline', 'fig.tv.orig': 'Original', 'fig.tv.origOut': 'Original with outline', 'fig.tv.iso': 'Trace only', 'fig.tv.isoEnh': 'Trace only (treated)', 'fig.tv.isoOut': 'Trace only with outline', 'fig.tv.mask': 'Coloured silhouette', 'fig.tv.outline': 'Outline only',
  'fig.sc.style': 'Scale', 'fig.sc.bar': 'Bar', 'fig.sc.ticks': 'Bar with divisions', 'fig.sc.line': 'Line with end ticks', 'fig.sc.none': 'No scale', 'fig.sc.pos': 'Scale position', 'fig.sc.p.bl': 'Bottom left', 'fig.sc.p.br': 'Bottom right', 'fig.sc.p.tl': 'Top left', 'fig.sc.p.tr': 'Top right', 'fig.sc.len': 'Length (cm)', 'fig.sc.div': 'Divisions', 'fig.sc.colors': 'Colours (fill, edge)', 'fig.sc.all': 'Scale on every version' });

/* V0.8: packages, project folders */
Object.assign(D.es, { 'proj.openFolder': 'Abrir carpeta de proyecto…', 'proj.openFolderTip': 'Abre un proyecto guardado como carpeta (copia automática), por ejemplo en una carpeta compartida de Drive.', 'bk.noFolderProject': 'Esa carpeta no contiene ningún proyecto (project.json).', 'bk.replaceAsk': '«{n}» ya está en tu biblioteca.\n\nTu versión: {a}\nVersión que abres: {b}\n\nAceptar: sustituir tu versión por la que abres.\nCancelar: importarla como copia.', 'proj.export': 'Exportar este proyecto (con imágenes)' });
Object.assign(D.en, { 'proj.openFolder': 'Open project folder…', 'proj.openFolderTip': 'Opens a project saved as a folder (automatic copy), e.g. in a shared Drive folder.', 'bk.noFolderProject': 'That folder contains no project (project.json).', 'bk.replaceAsk': '“{n}” is already in your library.\n\nYour version: {a}\nVersion being opened: {b}\n\nOK: replace your version with this one.\nCancel: import it as a copy.', 'proj.export': 'Export this project (with images)' });
Object.assign(D.es, { 'cmt.title': 'Comentarios del proyecto', 'cmt.author': 'Tu nombre', 'cmt.filter': 'Mostrar', 'cmt.f.all': 'Todos', 'cmt.f.open': 'Sin resolver', 'cmt.f.sec': 'De esta sección', 'cmt.ph': 'Escribe un comentario…', 'cmt.link': 'Vincular a la sección actual (punto del centro de la vista)', 'cmt.add': 'Comentar', 'cmt.general': 'General', 'cmt.go': 'Ir', 'cmt.replyPh': 'Responder…', 'cmt.reply': 'Responder', 'cmt.resolve': 'Resolver', 'cmt.reopen': 'Reabrir', 'cmt.del': 'Borrar', 'cmt.delAsk': '¿Borrar este comentario?', 'cmt.none': 'No hay comentarios.' });
Object.assign(D.en, { 'cmt.title': 'Project comments', 'cmt.author': 'Your name', 'cmt.filter': 'Show', 'cmt.f.all': 'All', 'cmt.f.open': 'Unresolved', 'cmt.f.sec': 'This section', 'cmt.ph': 'Write a comment…', 'cmt.link': 'Link to the current section (point at the centre of the view)', 'cmt.add': 'Comment', 'cmt.general': 'General', 'cmt.go': 'Go', 'cmt.replyPh': 'Reply…', 'cmt.reply': 'Reply', 'cmt.resolve': 'Resolve', 'cmt.reopen': 'Reopen', 'cmt.del': 'Delete', 'cmt.delAsk': 'Delete this comment?', 'cmt.none': 'No comments.' });

Object.assign(D.es, { 'obj.listSelected': 'Trazas seleccionadas ({n})', 'obj.listAll': 'Todas las trazas de esta imagen ({n})', 'obj.listEmpty': 'No hay trazas en esta imagen.', 'obj.listFocus': 'Centrar esta traza', 'obj.listSelect': 'Seleccionar esta traza' });
Object.assign(D.en, { 'obj.listSelected': 'Selected traces ({n})', 'obj.listAll': 'All traces in this image ({n})', 'obj.listEmpty': 'There are no traces in this image.', 'obj.listFocus': 'Center this trace', 'obj.listSelect': 'Select this trace' });

Object.assign(D.es, { 'edit.step': 'Paso', 'edit.labels': 'Editar textos y posiciones', 'edit.label': 'Etiqueta', 'edit.text': 'Texto', 'edit.reset': 'Restaurar esta etiqueta', 'edit.hint': 'Elige un texto para editarlo o, con este panel desplegado, arrástralo en el gráfico. Los desplazamientos se guardan y se exportan. En los ejes, Paso es la distancia entre marcas (lineal); log requiere límites positivos. Las unidades verticales y el paso se eligen en Estilo de columna.' });
Object.assign(D.en, { 'edit.step': 'Step', 'edit.labels': 'Edit text and positions', 'edit.label': 'Label', 'edit.text': 'Text', 'edit.reset': 'Reset this label', 'edit.hint': 'Choose a label or drag it in the chart while this panel is open. Offsets are saved and exported. Axis Step is the distance between ticks (linear); log requires positive limits. Choose vertical units and tick spacing in Column style.' });

Object.assign(D.es, { 'edit.invalidAxis': 'El máximo debe ser mayor que el mínimo. En escala logarítmica ambos límites deben ser positivos.' });
Object.assign(D.en, { 'edit.invalidAxis': 'Maximum must exceed minimum. Logarithmic limits must both be positive.' });

Object.assign(D.es, { 'fig.rangeDisplay': 'Representación de icnotaxones', 'fig.rangeDisplay.symbols': 'Solo símbolos (presencia)', 'fig.rangeDisplay.bars': 'Barras (abundancia)', 'fig.rangeDisplay.both': 'Barras y símbolos', 'fig.taxonSymbols': 'Símbolo de cada icnotaxón', 'fig.ms.diamond': 'Rombo', 'fig.rangeNote': 'Un símbolo por intervalo con presencia del icnotaxón, a partir de trazas cuantificadas o marcas identificadas. Puedes mostrar barras de abundancia o ambas representaciones. El símbolo de cada icnotaxón se guarda y se aplica también a sus marcas en la imagen y la columna.', 'fig.rangeSubBoth': 'Abundancia por intervalo (barras) y presencia (símbolos)' });
Object.assign(D.en, { 'fig.rangeDisplay': 'Ichnotaxon display', 'fig.rangeDisplay.symbols': 'Symbols only (presence)', 'fig.rangeDisplay.bars': 'Bars (abundance)', 'fig.rangeDisplay.both': 'Bars and symbols', 'fig.taxonSymbols': 'Symbol for each ichnotaxon', 'fig.ms.diamond': 'Diamond', 'fig.rangeNote': 'One symbol per interval with ichnotaxon presence, from quantified traces or identified marks. Choose abundance bars or both representations. Each ichnotaxon symbol is saved and also used for its marks in the image and core column.', 'fig.rangeSubBoth': 'Abundance per interval (bars) and presence (symbols)' });

// V0.19: automatic hover help. 'h.<key>' explains the control whose label/button uses data-i18n="<key>" (or '#<id>').
Object.assign(D.es, {
  'hh.toggle': 'Mostrar ayuda al pasar el ratón por los controles',
  'h.#coreSel': 'Sondeo que estás analizando. Cambia de sondeo dentro del proyecto.',
  'h.top.help': 'Guía de uso, recorrido guiado y opciones de ayuda.',
  'h.bk.reactivate': 'La copia automática en carpeta está en pausa; pulsa para volver a activarla.',
  'h.sec.maxMP': 'Tamaño máximo con el que se trabaja cada imagen nueva. Más alto = más detalle pero más lento.',
  'h.sec.section': 'Imagen (tramo del sondeo) que se muestra y se edita.',
  'h.sec.name': 'Nombre de esta sección, usado en tablas y figuras.',
  'h.sec.top': 'Profundidad del borde superior de la zona de análisis.',
  'h.sec.bottom': 'Profundidad del borde inferior de la zona de análisis.',
  'h.sec.units': 'Unidades de las profundidades de techo y muro.',
  'h.roi.draw': 'Dibuja sobre la imagen el rectángulo que se analiza; lo de fuera se ignora.',
  'h.roi.reset': 'Analizar la imagen completa (quita la zona dibujada).',
  'h.sec.res': 'Resolución con la que se trabaja esta sección. Más alta = más detalle y más lento.',
  'h.sec.resAll': 'Pone a todas las secciones la misma resolución (px/cm) que esta, para que sean comparables.',
  'h.age.title': 'Unidad de las edades del modelo de edad (profundidad → edad).',
  'h.f.preset': 'Realce predefinido de la imagen. Solo cambia lo que ves y lo que detecta el programa, no el archivo original.',
  'h.#presetName': 'Nombre con el que guardar el realce actual para reutilizarlo.',
  'h.f.save': 'Guarda el realce actual con el nombre escrito.',
  'h.f.applyAll': 'Copia este realce a todas las secciones del sondeo.',
  'h.f.best': 'Prueba los ajustes y elige el que mejor separa trazas y matriz en esta sección.',
  'h.f.channel': 'Canal de color usado. Un canal concreto puede resaltar mejor las trazas que el color completo.',
  'h.f.equalize': 'Reparte los tonos por todo el rango para aumentar el contraste global.',
  'h.f.invert': 'Invierte claros y oscuros (útil si las trazas son más claras que la matriz).',
  'h.f.blackPoint': 'Los tonos por debajo de este valor pasan a negro. Subir = imagen más oscura y contrastada.',
  'h.f.whitePoint': 'Los tonos por encima de este valor pasan a blanco. Bajar = imagen más clara y contrastada.',
  'h.f.gamma': 'Ajusta los tonos medios. Menor que 1 = más oscuros; mayor que 1 = más claros.',
  'h.f.brightness': 'Aclara (+) u oscurece (−) toda la imagen.',
  'h.f.contrast': 'Aumenta (+) o reduce (−) la diferencia entre claros y oscuros.',
  'h.f.saturation': 'Intensidad del color. 100 = original; 0 = gris.',
  'h.f.vibrance': 'Aviva los colores apagados sin saturar los que ya son intensos.',
  'h.f.claheBlock': 'Tamaño de las zonas donde se ecualiza el contraste local (CLAHE). Más pequeño = más detalle local; 0 = desactivado.',
  'h.f.claheSlope': 'Límite del realce CLAHE. Más alto = más contraste, pero también más ruido.',
  'h.f.localAmount': 'Intensidad del contraste local: resalta bordes y texturas finas.',
  'h.f.localRadius': 'Tamaño de los detalles que realza el contraste local. Más grande = estructuras más gruesas.',
  'h.d.method': 'Cómo se separan las trazas de la matriz: umbral local, umbral único para toda la imagen o red U-Net entrenada.',
  'h.u.doubt': 'Marca las zonas donde la red no está segura, para revisarlas a mano.',
  'h.tr.open': 'Entrena una red U-Net con tus máscaras anotadas en este ordenador.',
  'h.d.polarity': 'Indica si las trazas son más oscuras, más claras o de ambos tipos respecto a la matriz.',
  'h.d.fill': 'Rellena los huecos cerrados dentro de cada traza detectada.',
  'h.d.run': 'Busca trazas candidatas con los ajustes actuales. No borra lo que ya has identificado.',
  'h.d.clear': 'Quita los candidatos sin revisar; conserva lo ya identificado.',
  'h.d.offset': 'Diferencia de tono necesaria respecto al entorno. Más bajo = detecta más (y más ruido).',
  'h.d.radius': 'Tamaño del entorno con el que se compara cada píxel. Debe ser mayor que las trazas.',
  'h.d.threshold': 'Tono que separa trazas y matriz en toda la imagen.',
  'h.d.pThr': 'Probabilidad de la red a partir de la cual un píxel es traza. Más alto = más estricto.',
  'h.d.minArea': 'Se descartan las manchas más pequeñas que este tamaño (ruido).',
  'h.d.smooth': 'Suaviza los contornos detectados. Más alto = formas más redondeadas.',
  'h.a.bin': 'Altura de cada intervalo de cálculo. Más pequeño = curva más detallada y ruidosa.',
  'h.a.inclPred': 'Incluye en los resultados los objetos clasificados automáticamente, no solo los revisados.',
  'h.a.minValid': 'Un intervalo con menos superficie válida (no excluida) que este porcentaje queda sin dato.',
  'h.a.countCand': 'Cuenta como bioturbación los candidatos que aún no has revisado.',
  'h.id.mode': 'Al hacer clic sobre un objeto se le asigna el icnotaxón seleccionado.',
  'h.tool.shape': 'Forma de la herramienta de dibujo o borrado.',
  'h.tool.size': 'Tamaño del pincel en píxeles.',
  'h.tool.tol': 'Varita mágica: diferencia de tono admitida. Más alto = selecciona zonas más amplias.',
  'h.view.orig': 'Muestra la imagen original sin realce.',
  'h.view.overlay': 'Opacidad de la capa de trazas sobre la imagen.',
  'h.view.fit': 'Ajusta el zoom para ver la imagen completa.',
  'h.crop.apply': 'Recorta la imagen a la zona de análisis.',
  'h.empty.example': 'Abre un sondeo de ejemplo para probar el programa.',
  'h.tab.classes': 'Lista de icnotaxones: colores, visibilidad y recuento.',
  'h.tab.object': 'Datos del objeto seleccionado y su clasificación.',
  'h.tab.learn': 'Sugerencias automáticas de icnotaxón a partir de tus ejemplos.',
  'h.tab.results': 'Índices de bioturbación y exportación de resultados.',
  'h.cls.showAll': 'Vuelve a mostrar todos los icnotaxones ocultos.',
  'h.cls.add': 'Crea un icnotaxón nuevo.',
  'h.obj.next': 'Salta al siguiente objeto sin revisar (atajo: N).',
  'h.obj.autoNext': 'Al asignar un icnotaxón, pasa automáticamente al siguiente objeto.',
  'h.ml.open': 'Modelos de clasificación: cómo funcionan, evaluación y ejemplos.',
  'h.l.thr': 'Solo se sugieren clasificaciones con al menos esta confianza. Más alto = menos sugerencias pero más fiables.',
  'h.l.novelty': 'Cuánto puede diferir un objeto de los ejemplos para recibir sugerencia. Más bajo = deja sin sugerir las formas raras.',
  'h.l.accept': 'Acepta todas las sugerencias visibles como identificaciones.',
  'h.l.export': 'Guarda el modelo (ejemplos y rasgos) para usarlo en otro proyecto.',
  'h.l.clearLib': 'Olvida los ejemplos importados de otros proyectos.',
  'h.r.csv': 'Descarga los índices por intervalo en CSV (hoja de cálculo).',
  'h.r.objectsCsv': 'Descarga una fila por objeto con su clase, profundidad y medidas.',
  'h.r.mask': 'Descarga la máscara de trazas como imagen PNG.',
  'h.r.palette': 'Descarga los colores de los icnotaxones para reutilizarlos.',
  'h.log.axis': 'Representar la columna frente a profundidad o edad.',
  'h.log.from': 'Límite superior del tramo mostrado.',
  'h.log.to': 'Límite inferior del tramo mostrado.',
  'h.log.all': 'Muestra todo el sondeo.',
  'h.log.height': 'Altura del gráfico en pantalla y en la figura exportada.',
  'h.log.noDataPad': 'Ensancha las zonas sin datos para que se vean en la columna.',
  'h.log.image': 'Muestra la imagen del sondeo como primera columna.',
  'h.log.total': 'Curva de bioturbación total (%).',
  'h.log.species': 'Curvas de porcentaje de cada icnotaxón.',
  'h.#BI': 'Índice de bioturbación (BI) por intervalo.',
  'h.#ii': 'Índice icnológico (ii) por intervalo.',
  'h.log.manual': 'Índices medidos a mano con la marca negra.',
  'h.log.imgMode': 'Qué versión de la imagen se dibuja en la columna.',
  'h.log.overlay': 'Dibuja las trazas en color sobre la imagen de la columna.',
  'h.log.hideExcl': 'Tapa las zonas excluidas del análisis.',
  'h.log.svg': 'Exporta la columna como SVG, editable en Inkscape o Illustrator.',
  'h.log.csv': 'Exporta los datos de la columna en CSV.',
  'h.win.new': 'Abre esta vista en otra ventana (útil con dos pantallas).',
  'h.win.panel': 'Abre esta vista en un panel flotante sobre el programa.',
  'h.fig.type': 'Tipo de figura que se compone.',
  'h.fig.title': 'Título que aparece en la figura.',
  'h.#figSvg': 'Exporta la figura como SVG (vectorial, editable).',
  'h.#figPng': 'Exporta la figura como imagen PNG. Con 300 o 600 dpi el archivo declara esa resolución, calculada sobre el tamaño de la figura en pantalla (96 px por pulgada).',
  'h.data.core': 'Sondeo cuyos datos se muestran.',
  'h.data.showLayers': 'Muestra también las capas de intervalos en la tabla.',
  'h.data.csv': 'Descarga la tabla en CSV.',
  'h.geo.step': 'Distancia entre muestras al llevar todos los registros a un eje común.',
  'h.geo.scaling': 'Cómo se normalizan las variables antes de clasificar, para que ninguna pese más por sus unidades.',
  'h.geo.maxGap': 'No se interpola a través de huecos mayores que esta distancia.',
  'h.geo.missingSel': 'Qué hacer cuando un sondeo no tiene alguna de las variables.',
  'h.geo.ratio': 'Crea una variable nueva dividiendo dos registros (A/B).',
  'h.geo.layer': 'Capa de intervalos que estás editando.',
  'h.geo.layerName': 'Cambia el nombre de esta capa.',
  'h.geo.layerParent': 'Capa de la que esta es subdivisión (jerarquía).',
  'h.#geoNewLayer': 'Nombre de la capa nueva.',
  'h.geo.addLayer': 'Crea una capa de intervalos nueva.',
  'h.geo.newLayerChild': 'La nueva capa subdivide los intervalos de la capa actual.',
  'h.#geoNewLabel': 'Nombre de la etiqueta (clase) nueva.',
  'h.geo.addLabel': 'Añade una etiqueta a esta capa.',
  'h.geo.addRule': 'Añade una regla que etiqueta intervalos según los valores de los registros.',
  'h.geo.useRules': 'Etiqueta automáticamente con las reglas además de los intervalos dibujados.',
  'h.geo.tab.logs': 'Registros de cada sondeo e intervalos.',
  'h.geo.tab.map': 'Mapa de valores entre sondeos.',
  'h.cl.tab': 'Clasificador automático de intervalos y su validación.',
  'h.#geoCoreSel': 'Sondeo que se muestra.',
  'h.geo.shade': 'Colorea el fondo de los registros según la clase de cada intervalo.',
  'h.gx.trackW': 'Ancho de cada columna de registro.',
  'h.geo.clearAuto': 'Borra los intervalos creados por el clasificador; conserva los tuyos.',
  'h.geo.ivCsv': 'Descarga los intervalos en CSV.',
  'h.geo.ageFrom': 'Inicio del tramo de edad que se representa.',
  'h.geo.ageTo': 'Final del tramo de edad que se representa.',
  'h.geo.mapMode': 'Qué se representa en el mapa.',
  'h.geo.feature': 'Registro (proxy) que se representa.',
  'h.#gmIdw': 'Interpola entre sondeos (inverso de la distancia, IDW).',
  'h.#gmR0': 'Inicio del tramo de referencia.',
  'h.#gmR1': 'Final del tramo de referencia.',
  'h.#gmSvg': 'Exporta el mapa como SVG.',
  'h.#gmPngW': 'Ancho en píxeles del PNG exportado.',
  'h.#gmPng': 'Exporta el mapa como PNG.',
  'h.geo.predCsv': 'Descarga la clasificación automática en CSV.',
  'h.cmt.author': 'Nombre que aparecerá en tus comentarios.',
  'h.cmt.filter': 'Qué comentarios se muestran.',
  'h.cmt.link': 'Ata el comentario al punto que estás viendo para encontrarlo luego.',
  'h.cmt.add': 'Publica el comentario en el proyecto.',
  'h.tour.start': 'Recorrido guiado por las partes del programa.',
  'h.tip.toggle': 'Muestra consejos según lo que estés haciendo.',
  'h.home.newProject': 'Crea un proyecto vacío.',
  'h.home.back': 'Vuelve al proyecto que tenías abierto.',
  'h.#newProjName': 'Nombre del proyecto nuevo.',
  'h.#homeSearch': 'Busca proyectos y sondeos por nombre.',
  'h.tut.open': 'Abre el tutorial paso a paso.',
  'h.proj.test': 'Abre un sondeo real de prueba.',
  'h.proj.ideal': 'Abre el ejemplo idealizado con el que se compara la V2.1.',
  'h.bk.choose': 'Elige una carpeta (por ejemplo, de Drive) donde se guarda sola una copia de los proyectos.',
  'h.bk.full': 'Descarga un archivo con todos los proyectos e imágenes.',
  'h.proj.export': 'Descarga este proyecto completo (con imágenes) para abrirlo en otro ordenador.',
  'h.#amSvg': 'Exporta como SVG.', 'h.#amPngW': 'Ancho en píxeles del PNG exportado.', 'h.#amPng': 'Exporta como PNG.',
  'h.mp.all': 'Marca todos los sondeos de la tabla.',
  'h.mp.none': 'Desmarca todos los sondeos.',
  'h.#mpName': 'Nombre del análisis entre proyectos.',
  'h.mp.create': 'Crea un análisis con los sondeos marcados.',
  'h.rec.name': 'Nombre con el que aparecerá el registro.',
  'h.rec.x': 'Columna del archivo que contiene la profundidad o la edad.',
  'h.rec.axis': 'Indica si esa columna es profundidad o edad.',
  'h.geo.r.core': 'Columna del archivo con el nombre del sondeo.',
  'h.geo.r.wd': 'Columna con la profundidad de agua.',
  'h.#giLat': 'Columna con la latitud (grados decimales).',
  'h.#giLon': 'Columna con la longitud (grados decimales).',
  'h.log.depth': 'Columna con la profundidad.',
  'h.log.age': 'Columna con la edad.',
  'h.geo.r.from': 'Columna con el techo de cada intervalo.',
  'h.geo.r.to': 'Columna con la base de cada intervalo.',
  'h.geo.r.ivAxis': 'Si techo y base están en profundidad o en edad.',
  'h.geo.r.layerCol': 'Columna con la capa de cada intervalo, si el archivo trae varias.',
  'h.geo.r.defCore': 'Sondeo al que se asignan los datos si el archivo no indica sondeo.',
  'h.ml.tab.guide': 'Explicación del método de clasificación.',
  'h.ml.tab.train': 'Método, ajustes y evaluación del modelo.',
  'h.ml.tab.examples': 'Ejemplos de este proyecto usados para aprender.',
  'h.ml.tab.others': 'Ejemplos traídos de otros proyectos.',
  'h.core.name': 'Nombre del sondeo.',
  'h.#cdLat': 'Latitud en grados decimales (positiva al norte).',
  'h.#cdLon': 'Longitud en grados decimales (positiva al este).',
  'h.core.units': 'Unidades de profundidad del sondeo.',
  'h.#cdDel': 'Elimina el sondeo del proyecto.',
  'h.#floatClose': 'Cierra el panel flotante.'
});
Object.assign(D.en, {
  'hh.toggle': 'Show help when hovering over controls',
  'h.#coreSel': 'Core you are analysing. Switches core within the project.',
  'h.top.help': 'User guide, guided tour and help options.',
  'h.bk.reactivate': 'The automatic folder backup is paused; click to turn it back on.',
  'h.sec.maxMP': 'Maximum working size for each new image. Higher = more detail but slower.',
  'h.sec.section': 'Image (core stretch) shown and edited.',
  'h.sec.name': 'Name of this section, used in tables and figures.',
  'h.sec.top': 'Depth of the upper edge of the analysis area.',
  'h.sec.bottom': 'Depth of the lower edge of the analysis area.',
  'h.sec.units': 'Units of the top and bottom depths.',
  'h.roi.draw': 'Draw on the image the rectangle to analyse; everything outside is ignored.',
  'h.roi.reset': 'Analyse the whole image (removes the drawn area).',
  'h.sec.res': 'Working resolution of this section. Higher = more detail and slower.',
  'h.sec.resAll': 'Gives every section the same resolution (px/cm) as this one, so they are comparable.',
  'h.age.title': 'Unit of the ages in the age model (depth → age).',
  'h.f.preset': 'Predefined image enhancement. It only changes what you see and what is detected, never the original file.',
  'h.#presetName': 'Name to save the current enhancement under, to reuse it.',
  'h.f.save': 'Saves the current enhancement under the typed name.',
  'h.f.applyAll': 'Copies this enhancement to every section of the core.',
  'h.f.best': 'Tries the settings and picks the one that best separates traces from matrix in this section.',
  'h.f.channel': 'Colour channel used. A single channel may show traces better than full colour.',
  'h.f.equalize': 'Spreads the tones over the full range to raise global contrast.',
  'h.f.invert': 'Swaps light and dark (useful when traces are lighter than the matrix).',
  'h.f.blackPoint': 'Tones below this value become black. Raise = darker, more contrasted image.',
  'h.f.whitePoint': 'Tones above this value become white. Lower = lighter, more contrasted image.',
  'h.f.gamma': 'Adjusts midtones. Below 1 = darker; above 1 = lighter.',
  'h.f.brightness': 'Lightens (+) or darkens (−) the whole image.',
  'h.f.contrast': 'Increases (+) or reduces (−) the difference between light and dark.',
  'h.f.saturation': 'Colour intensity. 100 = original; 0 = grey.',
  'h.f.vibrance': 'Boosts dull colours without oversaturating strong ones.',
  'h.f.claheBlock': 'Size of the tiles where local contrast is equalised (CLAHE). Smaller = more local detail; 0 = off.',
  'h.f.claheSlope': 'CLAHE enhancement limit. Higher = more contrast, but also more noise.',
  'h.f.localAmount': 'Strength of local contrast: enhances edges and fine textures.',
  'h.f.localRadius': 'Size of the details enhanced by local contrast. Larger = coarser structures.',
  'h.d.method': 'How traces are separated from the matrix: local threshold, one threshold for the whole image, or a trained U-Net.',
  'h.u.doubt': 'Marks areas where the network is unsure, to review them by hand.',
  'h.tr.open': 'Trains a U-Net with your annotated masks on this computer.',
  'h.d.polarity': 'Whether traces are darker, lighter or both relative to the matrix.',
  'h.d.fill': 'Fills closed holes inside each detected trace.',
  'h.d.run': 'Looks for candidate traces with the current settings. Does not delete what you have identified.',
  'h.d.clear': 'Removes unreviewed candidates; keeps what is identified.',
  'h.d.offset': 'Tone difference needed from the surroundings. Lower = detects more (and more noise).',
  'h.d.radius': 'Size of the neighbourhood each pixel is compared with. It should be larger than the traces.',
  'h.d.threshold': 'Tone separating traces from matrix over the whole image.',
  'h.d.pThr': 'Network probability above which a pixel is a trace. Higher = stricter.',
  'h.d.minArea': 'Blobs smaller than this are discarded (noise).',
  'h.d.smooth': 'Smooths the detected outlines. Higher = rounder shapes.',
  'h.a.bin': 'Height of each calculation interval. Smaller = more detailed, noisier curve.',
  'h.a.inclPred': 'Includes automatically classified objects in the results, not only reviewed ones.',
  'h.a.minValid': 'An interval with less valid (non-excluded) area than this percentage gets no value.',
  'h.a.countCand': 'Counts candidates you have not reviewed yet as bioturbation.',
  'h.id.mode': 'Clicking an object assigns it the selected ichnotaxon.',
  'h.tool.shape': 'Shape of the drawing or erasing tool.',
  'h.tool.size': 'Brush size in pixels.',
  'h.tool.tol': 'Magic wand: allowed tone difference. Higher = selects wider areas.',
  'h.view.orig': 'Shows the original image without enhancement.',
  'h.view.overlay': 'Opacity of the trace layer over the image.',
  'h.view.fit': 'Fits the zoom to show the whole image.',
  'h.crop.apply': 'Crops the image to the analysis area.',
  'h.empty.example': 'Opens an example core to try the program.',
  'h.tab.classes': 'List of ichnotaxa: colours, visibility and counts.',
  'h.tab.object': 'Data of the selected object and its classification.',
  'h.tab.learn': 'Automatic ichnotaxon suggestions learnt from your examples.',
  'h.tab.results': 'Bioturbation indices and export of results.',
  'h.cls.showAll': 'Shows all hidden ichnotaxa again.',
  'h.cls.add': 'Creates a new ichnotaxon.',
  'h.obj.next': 'Jumps to the next unreviewed object (shortcut: N).',
  'h.obj.autoNext': 'After assigning an ichnotaxon, moves on to the next object.',
  'h.ml.open': 'Classification models: how they work, evaluation and examples.',
  'h.l.thr': 'Only classifications with at least this confidence are suggested. Higher = fewer but more reliable suggestions.',
  'h.l.novelty': 'How different from the examples an object may be and still get a suggestion. Lower = unusual shapes are left unsuggested.',
  'h.l.accept': 'Accepts all visible suggestions as identifications.',
  'h.l.export': 'Saves the model (examples and features) to use it in another project.',
  'h.l.clearLib': 'Forgets examples imported from other projects.',
  'h.r.csv': 'Downloads the indices per interval as CSV (spreadsheet).',
  'h.r.objectsCsv': 'Downloads one row per object with its class, depth and measurements.',
  'h.r.mask': 'Downloads the trace mask as a PNG image.',
  'h.r.palette': 'Downloads the ichnotaxon colours to reuse them.',
  'h.log.axis': 'Plot the log against depth or age.',
  'h.log.from': 'Upper limit of the stretch shown.',
  'h.log.to': 'Lower limit of the stretch shown.',
  'h.log.all': 'Shows the whole core.',
  'h.log.height': 'Height of the plot on screen and in the exported figure.',
  'h.log.noDataPad': 'Widens no-data zones so they are visible in the log.',
  'h.log.image': 'Shows the core image as the first track.',
  'h.log.total': 'Total bioturbation curve (%).',
  'h.log.species': 'Percentage curve of each ichnotaxon.',
  'h.#BI': 'Bioturbation index (BI) per interval.',
  'h.#ii': 'Ichnofabric index (ii) per interval.',
  'h.log.manual': 'Indices measured by hand with the black mark.',
  'h.log.imgMode': 'Which version of the image is drawn in the log.',
  'h.log.overlay': 'Draws the traces in colour over the log image.',
  'h.log.hideExcl': 'Covers areas excluded from the analysis.',
  'h.log.svg': 'Exports the log as SVG, editable in Inkscape or Illustrator.',
  'h.log.csv': 'Exports the log data as CSV.',
  'h.win.new': 'Opens this view in another window (handy with two screens).',
  'h.win.panel': 'Opens this view in a floating panel over the program.',
  'h.fig.type': 'Type of figure being composed.',
  'h.fig.title': 'Title shown on the figure.',
  'h.#figSvg': 'Exports the figure as SVG (vector, editable).',
  'h.#figPng': 'Exports the figure as a PNG image. At 300 or 600 dpi the file declares that resolution, computed on the figure\'s size on screen (96 px per inch).',
  'h.data.core': 'Core whose data are shown.',
  'h.data.showLayers': 'Also shows the interval layers in the table.',
  'h.data.csv': 'Downloads the table as CSV.',
  'h.geo.step': 'Sample spacing when bringing all logs onto a common axis.',
  'h.geo.scaling': 'How variables are normalised before classifying, so none weighs more because of its units.',
  'h.geo.maxGap': 'No interpolation across gaps larger than this distance.',
  'h.geo.missingSel': 'What to do when a core lacks one of the variables.',
  'h.geo.ratio': 'Creates a new variable by dividing two logs (A/B).',
  'h.geo.layer': 'Interval layer being edited.',
  'h.geo.layerName': 'Renames this layer.',
  'h.geo.layerParent': 'Layer this one subdivides (hierarchy).',
  'h.#geoNewLayer': 'Name of the new layer.',
  'h.geo.addLayer': 'Creates a new interval layer.',
  'h.geo.newLayerChild': 'The new layer subdivides the intervals of the current layer.',
  'h.#geoNewLabel': 'Name of the new label (class).',
  'h.geo.addLabel': 'Adds a label to this layer.',
  'h.geo.addRule': 'Adds a rule that labels intervals from the log values.',
  'h.geo.useRules': 'Labels automatically with the rules as well as the drawn intervals.',
  'h.geo.tab.logs': 'Logs of each core and intervals.',
  'h.geo.tab.map': 'Map of values across cores.',
  'h.cl.tab': 'Automatic interval classifier and its validation.',
  'h.#geoCoreSel': 'Core shown.',
  'h.geo.shade': 'Colours the log background by the class of each interval.',
  'h.gx.trackW': 'Width of each log track.',
  'h.geo.clearAuto': 'Deletes the intervals created by the classifier; keeps yours.',
  'h.geo.ivCsv': 'Downloads the intervals as CSV.',
  'h.geo.ageFrom': 'Start of the age range shown.',
  'h.geo.ageTo': 'End of the age range shown.',
  'h.geo.mapMode': 'What the map shows.',
  'h.geo.feature': 'Log (proxy) shown.',
  'h.#gmIdw': 'Interpolates between cores (inverse distance weighting, IDW).',
  'h.#gmR0': 'Start of the reference range.',
  'h.#gmR1': 'End of the reference range.',
  'h.#gmSvg': 'Exports the map as SVG.',
  'h.#gmPngW': 'Width in pixels of the exported PNG.',
  'h.#gmPng': 'Exports the map as PNG.',
  'h.geo.predCsv': 'Downloads the automatic classification as CSV.',
  'h.cmt.author': 'Name shown on your comments.',
  'h.cmt.filter': 'Which comments are shown.',
  'h.cmt.link': 'Ties the comment to the spot you are viewing so it can be found later.',
  'h.cmt.add': 'Posts the comment to the project.',
  'h.tour.start': 'Guided tour of the parts of the program.',
  'h.tip.toggle': 'Shows tips for what you are doing.',
  'h.home.newProject': 'Creates an empty project.',
  'h.home.back': 'Returns to the project you had open.',
  'h.#newProjName': 'Name of the new project.',
  'h.#homeSearch': 'Searches projects and cores by name.',
  'h.tut.open': 'Opens the step-by-step tutorial.',
  'h.proj.test': 'Opens a real test core.',
  'h.proj.ideal': 'Opens the idealised example used to check the V2.1 results.',
  'h.bk.choose': 'Pick a folder (e.g. on Drive) where a copy of the projects is saved automatically.',
  'h.bk.full': 'Downloads one file with all projects and images.',
  'h.proj.export': 'Downloads this whole project (with images) to open it on another computer.',
  'h.#amSvg': 'Exports as SVG.', 'h.#amPngW': 'Width in pixels of the exported PNG.', 'h.#amPng': 'Exports as PNG.',
  'h.mp.all': 'Ticks every core in the table.',
  'h.mp.none': 'Unticks every core.',
  'h.#mpName': 'Name of the cross-project analysis.',
  'h.mp.create': 'Creates an analysis with the ticked cores.',
  'h.rec.name': 'Name the log will have.',
  'h.rec.x': 'File column holding depth or age.',
  'h.rec.axis': 'Whether that column is depth or age.',
  'h.geo.r.core': 'File column with the core name.',
  'h.geo.r.wd': 'Column with water depth.',
  'h.#giLat': 'Column with latitude (decimal degrees).',
  'h.#giLon': 'Column with longitude (decimal degrees).',
  'h.log.depth': 'Column with depth.',
  'h.log.age': 'Column with age.',
  'h.geo.r.from': 'Column with the top of each interval.',
  'h.geo.r.to': 'Column with the base of each interval.',
  'h.geo.r.ivAxis': 'Whether top and base are in depth or in age.',
  'h.geo.r.layerCol': 'Column with the layer of each interval, if the file has several.',
  'h.geo.r.defCore': 'Core the data go to when the file has no core column.',
  'h.ml.tab.guide': 'Explanation of the classification method.',
  'h.ml.tab.train': 'Method, settings and evaluation of the model.',
  'h.ml.tab.examples': 'Examples from this project used for learning.',
  'h.ml.tab.others': 'Examples brought from other projects.',
  'h.core.name': 'Core name.',
  'h.#cdLat': 'Latitude in decimal degrees (positive north).',
  'h.#cdLon': 'Longitude in decimal degrees (positive east).',
  'h.core.units': 'Depth units of the core.',
  'h.#cdDel': 'Removes the core from the project.',
  'h.#floatClose': 'Closes the floating panel.'
});

// V0.20: overlapping traces, scissors and merge
Object.assign(D.es, {
  'tool.cut': 'Tijeras: traza una línea a través de una traza para dividirla (C)',
  'tool.erase': 'Borrador (E). Mayús = borra solo la traza seleccionada',
  'tool.overlap': 'Superponer',
  'h.tool.overlap': 'Activado: la traza nueva se solapa con las de debajo y ambas cuentan (cada icnotaxón con su superficie completa; la bioturbación total cuenta el solape una vez). Desactivado: la nueva sustituye a la de debajo. Con el pincel, Mayús amplía la traza seleccionada.',
  'cut.none': 'La línea no cruza ninguna traza.',
  'cut.noSplit': 'La línea no separa la traza: tiene que cruzarla de lado a lado.',
  'cut.done': 'Traza dividida en {n}.',
  'obj.merge': 'Unir', 'obj.mergeTip': 'Une las trazas seleccionadas en una sola (conserva la clase de la mayor identificada a mano).',
});
Object.assign(D.en, {
  'tool.cut': 'Scissors: draw a line across a trace to split it (C)',
  'tool.erase': 'Eraser (E). Shift = erase only the selected trace',
  'tool.overlap': 'Overlap',
  'h.tool.overlap': 'On: the new trace overlaps those underneath and all count (each ichnotaxon with its full area; total bioturbation counts the overlap once). Off: the new trace replaces what is underneath. With the brush, Shift extends the selected trace.',
  'cut.none': 'The line does not cross any trace.',
  'cut.noSplit': 'The line does not split the trace: it must cross it from side to side.',
  'cut.done': 'Trace split into {n}.',
  'obj.merge': 'Merge', 'obj.mergeTip': 'Merges the selected traces into one (keeps the class of the largest one identified by hand).',
});

// V0.21: side column
Object.assign(D.es, {
  'p.add': '+ Registros', 'p.addTip': 'Añadir a la columna lateral registros de Datos (geoquímica, etc.). Arrastra el borde izquierdo de la columna para cambiar su ancho; doble clic lo restablece.',
  'p.noRecs': 'Este sondeo no tiene registros. Añádelos en la pestaña Datos.',
});
Object.assign(D.en, {
  'p.add': '+ Records', 'p.addTip': 'Add records from Data (geochemistry, etc.) to the side column. Drag the left edge of the column to change its width; double click restores it.',
  'p.noRecs': 'This core has no records. Add them in the Data tab.',
});

// V0.22: vertical axis ticks and Multiproxy scales
Object.assign(D.es, {
  'st.title': 'Escalas y estilo de la columna y su figura',
  'st.yStep': 'Números del eje cada', 'st.yMajor': 'Marcas largas cada', 'st.yMinor': 'Marcas cortas cada',
  'st.yLabelLen': 'Largo de las marcas con número (px)', 'st.yMinorLen': 'Largo de las marcas cortas (px)', 'st.none': 'ninguna',
  'st.scales': 'Escalas',
});
Object.assign(D.en, {
  'st.title': 'Scales and style of the column and its figure',
  'st.yStep': 'Axis numbers every', 'st.yMajor': 'Long ticks every', 'st.yMinor': 'Short ticks every',
  'st.yLabelLen': 'Length of numbered ticks (px)', 'st.yMinorLen': 'Length of short ticks (px)', 'st.none': 'none',
  'st.scales': 'Scales',
});

// V0.23: core column image panels, NO DATA, markers and arrows
Object.assign(D.es, {
  'log.panels': 'Paneles de imagen', 'log.panelsNote': 'Como en la figura de secciones: varios a la vez se ponen uno al lado del otro. Sin marcar, se usa la imagen elegida abajo. El estilo de las flechas se ajusta en Figuras › Secciones › Flechas y etiquetas. Con el eje en edad solo se muestra la imagen.',
  'log.imgAspect': 'Ancho de la imagen', 'log.asp.keep': 'Proporciones de la foto', 'log.asp.fixed': 'Ancho fijo',
  'log.imgStretch': 'Factor horizontal (1 = real)', 'log.imgW': 'Ancho (px)',
  'nd.title': 'Intervalos SIN DATOS', 'nd.fill': 'Relleno', 'nd.f.hatch': 'Rayado', 'nd.f.solid': 'Color liso', 'nd.f.none': 'Sin relleno',
  'nd.colors': 'Fondo y rayas', 'nd.text': 'Texto', 'nd.show': 'Mostrarlos', 'nd.label': 'Con texto', 'nd.image': 'También sobre las imágenes',
  'mk.title': 'Símbolos de las trazas', 'mk.size': 'Tamaño de los símbolos (× 1)', 'mk.stroke': 'Borde (color y grosor)', 'mk.strokeW': 'Grosor del borde (0 = sin borde)',
  'ar.title': 'Flechas y etiquetas', 'ar.src': 'Qué se señala', 'ar.src.all': 'Trazas y marcas', 'ar.src.marks': 'Solo las marcas puestas a mano', 'ar.src.objects': 'Solo las trazas (cada objeto)',
  'ar.objScale': 'Tamaño de las de cada traza (× 1)', 'ar.labelSize': 'Tamaño de las etiquetas', 'ar.labelColor': 'Color de las etiquetas', 'ar.halo': 'Halo blanco',
  'ar.excl': 'No señalar estos grupos',
});
Object.assign(D.en, {
  'log.panels': 'Image panels', 'log.panelsNote': 'As in the sections figure: several are placed side by side. With none ticked, the image chosen below is used. Arrow style is set in Figures › Sections › Arrows and labels. On the age axis only the image is shown.',
  'log.imgAspect': 'Image width', 'log.asp.keep': 'Photo proportions', 'log.asp.fixed': 'Fixed width',
  'log.imgStretch': 'Horizontal factor (1 = true)', 'log.imgW': 'Width (px)',
  'nd.title': 'NO DATA intervals', 'nd.fill': 'Fill', 'nd.f.hatch': 'Hatched', 'nd.f.solid': 'Plain colour', 'nd.f.none': 'No fill',
  'nd.colors': 'Background and hatch', 'nd.text': 'Text', 'nd.show': 'Show them', 'nd.label': 'With text', 'nd.image': 'Also over the images',
  'mk.title': 'Trace symbols', 'mk.size': 'Symbol size (× 1)', 'mk.stroke': 'Border (colour and width)', 'mk.strokeW': 'Border width (0 = no border)',
  'ar.title': 'Arrows and labels', 'ar.src': 'What is pointed at', 'ar.src.all': 'Traces and marks', 'ar.src.marks': 'Only marks placed by hand', 'ar.src.objects': 'Only traces (each object)',
  'ar.objScale': 'Size of those of each trace (× 1)', 'ar.labelSize': 'Label size', 'ar.labelColor': 'Label colour', 'ar.halo': 'White halo',
  'ar.excl': 'Do not point at these groups',
});

// V0.24: side column tracks
Object.assign(D.es, { 'p.add': '⚙ Columnas', 'p.tracks': 'Columnas', 'p.width': 'Ancho (px); vacío = automático', 'p.widthNote': 'También puedes arrastrar el borde derecho de cada columna en la cabecera. Bioturbación ocupa el espacio que sobra si no le fijas ancho.',
  'p.addTip': 'Mostrar u ocultar cada columna, su ancho y registros de Datos. Arrastra el borde izquierdo de la columna lateral para cambiar su ancho total; doble clic lo restablece.' });
Object.assign(D.en, { 'p.add': '⚙ Tracks', 'p.tracks': 'Tracks', 'p.width': 'Width (px); empty = automatic', 'p.widthNote': 'You can also drag the right edge of each track in the header. Bioturbation takes the remaining space unless given a width.',
  'p.addTip': 'Show or hide each track, its width and records from Data. Drag the left edge of the side column to change its total width; double click restores it.' });

// V0.26: navigation
Object.assign(D.es, { 'view.all': 'Ver todo', 'view.allTip': 'Muestra toda la zona de análisis de la sección. Para moverte: franja de la derecha (clic o arrastrar), rueda, Re Pág / Av Pág e Inicio / Fin.',
  'h.view.fit': 'Ajusta el zoom al ancho del sondeo.' });
Object.assign(D.en, { 'view.all': 'Show all', 'view.allTip': 'Shows the whole analysis area of the section. To move: strip on the right (click or drag), wheel, Page Up / Page Down and Home / End.',
  'h.view.fit': 'Fits the zoom to the core width.' });

// V0.27: interface review
Object.assign(D.es, { 'logs.win': 'Eje y tramo', 'logs.img': 'Imagen del sondeo', 'log.imgStretch': 'Factor horizontal', 'log.asp.keep': 'Proporción real' });
Object.assign(D.en, { 'logs.win': 'Axis and window', 'logs.img': 'Core image', 'log.imgStretch': 'Horizontal factor', 'log.asp.keep': 'True proportions' });

// V0.28: choose the enhancement setting
Object.assign(D.es, {
  'f.rankT': 'Separación entre tus {n} trazas identificadas y la matriz (0–1, como la ve la detección): {list}. Revisa el resultado a ojo.',
  'f.rankL': 'Sin trazas identificadas en esta sección: separación local de grises por zonas (Fisher en el umbral de Otsu por la coherencia espacial κ; 0 = como ruido): {list}. Identifica unas cuantas trazas y vuelve a pulsar para un resultado mejor.',
  'h.f.best': 'Prueba los ajustes y cada canal de color. Si en esta sección hay trazas identificadas a mano, elige el que mejor las separa de la matriz tal como las detecta el método elegido; si no, el que más contraste local da.',
});
Object.assign(D.en, {
  'f.rankT': 'Separation between your {n} identified traces and the matrix (0–1, as the detection sees it): {list}. Check the result by eye.',
  'f.rankL': 'No identified traces in this section: local grey-level separation by tiles (Fisher at the Otsu threshold times spatial coherence κ; 0 = like noise): {list}. Identify a few traces and press again for a better result.',
  'h.f.best': 'Tries the settings and each colour channel. With traces identified by hand in this section, picks the one that best separates them from the matrix as the chosen method detects them; otherwise the one with most local contrast.',
});
Object.assign(D.es, {
  'age.center': 'Edad del modelo Bacon', 'age.c.median': 'Mediana', 'age.c.mean': 'Media',
  'age.fileTip': 'CSV o texto con «profundidad, edad» y, opcionalmente, «mínimo, máximo» (intervalo de edad). También acepta la tabla *_ages.txt de Bacon (rbacon), que se pasa a las unidades del sondeo.',
  'age.baconHead': 'Bacon ({f}): {c} e intervalo del 95 %; profundidad en {u}, edad en {a}', 'age.cols': 'profundidad, edad, edad mínima, edad máxima',
  'age.baconOk': 'Modelo Bacon importado: {n} profundidades con intervalo del 95 %.',
  'age.errTrack': 'Intervalo de edad ({u})', 'age.errChip': 'Incertidumbre de edad', 'age.errTip': 'Anchura del intervalo de edad (p. ej. 95 % de Bacon) a cada profundidad. Solo aparece si el modelo de edad lo tiene.',
  'age.ph': 'profundidad, edad[, mín, máx]\n0, 0\n150, 12.5',
});
Object.assign(D.en, {
  'age.center': 'Age of the Bacon model', 'age.c.median': 'Median', 'age.c.mean': 'Mean',
  'age.fileTip': 'CSV or text with "depth, age" and, optionally, "minimum, maximum" (age interval). It also accepts the Bacon (rbacon) *_ages.txt table, converted to the core units.',
  'age.baconHead': 'Bacon ({f}): {c} and 95 % interval; depth in {u}, age in {a}', 'age.cols': 'depth, age, minimum age, maximum age',
  'age.baconOk': 'Bacon model imported: {n} depths with 95 % interval.',
  'age.errTrack': 'Age interval ({u})', 'age.errChip': 'Age uncertainty', 'age.errTip': 'Width of the age interval (e.g. Bacon 95 %) at each depth. Shown only when the age model has it.',
  'age.ph': 'depth, age[, min, max]\n0, 0\n150, 12.5',
});

// V0.29: overlap on by default
Object.assign(D.es, { 'tool.overlap': 'Superponer trazas (S)', 'ov.on': 'Superponer activado: las trazas nuevas se solapan con las de debajo.', 'ov.off': 'Superponer desactivado: las trazas nuevas sustituyen a las de debajo.',
  'ov.hint': 'La traza nueva ha sustituido parte de otra. Para que se solapen, activa «Superponer trazas» (tecla S).' });
Object.assign(D.en, { 'tool.overlap': 'Overlap traces (S)', 'ov.on': 'Overlap on: new traces overlap those underneath.', 'ov.off': 'Overlap off: new traces replace those underneath.',
  'ov.hint': 'The new trace replaced part of another. To make them overlap, turn on «Overlap traces» (key S).' });

// V0.31: ichnotaxa in charts
Object.assign(D.es, { 'sp.title': 'Icnotaxones en los gráficos', 'sp.mode': 'Representación', 'sp.stack': 'Apilados en una columna', 'sp.separate': 'Cada uno en su columna' });
Object.assign(D.en, { 'sp.title': 'Ichnotaxa in the charts', 'sp.mode': 'Display', 'sp.stack': 'Stacked in one column', 'sp.separate': 'Each in its own column' });

// V0.32: ichnotaxon distribution
Object.assign(D.es, { 'fig.axisFig': 'Eje vertical', 'fig.ptsSrc': 'Qué se representa', 'fig.ptsSrc.all': 'Trazas y marcas', 'fig.ptsSrc.objects': 'Trazas identificadas en la imagen', 'fig.ptsSrc.marks': 'Marcas puestas a mano',
  'fig.ptsHollow': 'Marcas a mano con símbolo hueco (para distinguirlas)', 'fig.rangeSubPts': 'Icnotaxones identificados, cada uno en su profundidad' });
Object.assign(D.en, { 'fig.axisFig': 'Vertical axis', 'fig.ptsSrc': 'What is shown', 'fig.ptsSrc.all': 'Traces and marks', 'fig.ptsSrc.objects': 'Traces identified on the image', 'fig.ptsSrc.marks': 'Marks placed by hand',
  'fig.ptsHollow': 'Hand-placed marks with a hollow symbol (to tell them apart)', 'fig.rangeSubPts': 'Identified ichnotaxa, each at its own depth' });
Object.assign(D.es, { 'fig.rangeNote': 'Un símbolo por cada traza identificada en la imagen (en el centro de la traza) y por cada marca puesta a mano, en su profundidad o edad. Elige qué representar y, con las dos, distingue las marcas con símbolo hueco. «Barras» muestra la abundancia por intervalo. El símbolo de cada icnotaxón se guarda y se usa también en la imagen y la columna.' });
Object.assign(D.en, { 'fig.rangeNote': 'One symbol per trace identified on the image (at the trace centre) and per hand-placed mark, at its depth or age. Choose what to show and, with both, tell marks apart with a hollow symbol. «Bars» shows abundance per interval. Each ichnotaxon symbol is saved and also used in the image and core column.' });

// V0.33: column order and visibility
Object.assign(D.es, { 'co.title': 'Orden y visibilidad de las columnas', 'co.note': 'Arrastra las filas o usa las flechas para cambiar el orden de izquierda a derecha. Desmarcar oculta la columna sin borrar sus datos (también las familias de intervalos).', 'co.empty': 'Las columnas aparecerán aquí cuando se dibuje el gráfico.', 'co.up': 'Mover a la izquierda', 'co.down': 'Mover a la derecha' });
Object.assign(D.en, { 'co.title': 'Column order and visibility', 'co.note': 'Drag the rows or use the arrows to change the order from left to right. Unticking hides the column without deleting its data (interval families too).', 'co.empty': 'Columns appear here once the chart is drawn.', 'co.up': 'Move left', 'co.down': 'Move right' });
Object.assign(D.es, { 'geo.layerShow': 'Mostrar esta familia en los gráficos', 'h.geo.layerShow': 'Oculta o muestra la columna de esta familia de intervalos en Columna, Figuras y Multiproxy. No borra los intervalos.' });
Object.assign(D.en, { 'geo.layerShow': 'Show this family in the charts', 'h.geo.layerShow': 'Hides or shows the column of this interval family in Core column, Figures and Multiproxy. The intervals are not deleted.' });

// V0.34: colour records by family
Object.assign(D.es, { 'sh.target': 'Clasificación (objetivo o predicción)', 'sh.mode': 'Varias familias', 'sh.mix': 'Mezclar colores', 'sh.split': 'Una franja por familia',
  'h.sh.mode': '«Mezclar» superpone los colores de las familias elegidas; «Una franja por familia» las pone una al lado de otra en cada registro.' });
Object.assign(D.en, { 'sh.target': 'Classification (target or prediction)', 'sh.mode': 'Several families', 'sh.mix': 'Blend colours', 'sh.split': 'One strip per family',
  'h.sh.mode': '«Blend» overlays the colours of the chosen families; «One strip per family» puts them side by side in each record.' });
Object.assign(D.es, { 'iv.tidied': 'Se han corregido intervalos solapados de una misma familia y se han unido los contiguos de la misma clase.' });
Object.assign(D.en, { 'iv.tidied': 'Overlapping intervals of the same family were corrected and touching intervals of the same class were joined.' });

// V0.35: Data as a spreadsheet
Object.assign(D.es, {
  'data.table': 'Hoja de datos', 'ds.edit': 'Permitir editar valores', 'ds.newCol': '+ Columna', 'ds.nMod': '{n} celdas modificadas a mano', 'ds.restoreCell': 'Restaurar celda', 'ds.restoreAll': 'Restaurar todas',
  'ds.viewport': 'Solo filas visibles',
  'ds.warn': 'Estás editando datos. Cada valor cambiado queda marcado (fondo amarillo y esquina roja), guarda el original y la fecha, se usa en los análisis y figuras y se indica en el CSV exportado. Enter baja una fila; Esc deshace la celda. Las columnas calculadas no se editan: cambia su fórmula (ƒ).',
  'ds.modTip': 'Modificado a mano el {d}. Original: {o}', 'ds.notNumber': 'Escribe un número (o deja la celda vacía para borrar el valor).',
  'ds.type': 'Tipo', 'ds.calc': 'Calculada con otras columnas', 'ds.man': 'Manual (para rellenar a mano)', 'ds.name': 'Nombre', 'ds.formula': 'Fórmula',
  'ds.formulaHelp': 'Usa los nombres de las columnas (entre corchetes si llevan espacios o símbolos; pulsa un nombre para insertarlo), números, + − × / ^ y paréntesis. Funciones: {f}.',
  'ds.manHelp': 'Crea una columna vacía en el sondeo elegido, con una fila por profundidad, para escribir valores. Al crearla se activa la edición.',
  'ds.add': 'Añadir columna', 'ds.save': 'Guardar', 'ds.del': 'Eliminar columna', 'ds.cancel': 'Cancelar', 'ds.editFx': 'Editar la fórmula',
  'ds.needName': 'Pon un nombre a la columna.', 'ds.needFormula': 'Escribe la fórmula.', 'ds.badFormula': 'La fórmula no es válida: {e}',
});
Object.assign(D.en, {
  'data.table': 'Data sheet', 'ds.edit': 'Allow editing values', 'ds.newCol': '+ Column', 'ds.nMod': '{n} cells edited by hand', 'ds.restoreCell': 'Restore cell', 'ds.restoreAll': 'Restore all',
  'ds.viewport': 'Visible rows only',
  'ds.warn': 'You are editing data. Every changed value is flagged (yellow background and red corner), keeps the original and the date, is used by the analyses and figures and is listed in the exported CSV. Enter moves down; Esc undoes the cell. Computed columns are not edited: change their formula (ƒ).',
  'ds.modTip': 'Edited by hand on {d}. Original: {o}', 'ds.notNumber': 'Type a number (or leave the cell empty to delete the value).',
  'ds.type': 'Type', 'ds.calc': 'Computed from other columns', 'ds.man': 'Manual (to fill in by hand)', 'ds.name': 'Name', 'ds.formula': 'Formula',
  'ds.formulaHelp': 'Use column names (in brackets when they contain spaces or symbols; click a name to insert it), numbers, + − × / ^ and parentheses. Functions: {f}.',
  'ds.manHelp': 'Creates an empty column in the chosen core, one row per depth, to type values in. Editing is turned on when it is created.',
  'ds.add': 'Add column', 'ds.save': 'Save', 'ds.del': 'Delete column', 'ds.cancel': 'Cancel', 'ds.editFx': 'Edit the formula',
  'ds.needName': 'Give the column a name.', 'ds.needFormula': 'Type the formula.', 'ds.badFormula': 'The formula is not valid: {e}',
});
Object.assign(D.es, { 'ds.interp': 'Interpolar las columnas usadas a la profundidad de cada fila (lineal, sin extrapolar; necesario si se midieron a profundidades distintas)' });
Object.assign(D.en, { 'ds.interp': 'Interpolate the columns used to the depth of each row (linear, no extrapolation; needed when they were measured at different depths)' });

// V0.36: data safety
Object.assign(D.es, {
  'fig.keepRatio': 'Mantener las proporciones de la foto', 'fig.ratioNote': 'Alto/ancho del testigo: {r}', 'geo.cancel': 'Cancelar',
  'sec.depthWarning': 'Revisa la profundidad de esta sección antes de usar sus resultados. Introduce valores numéricos, con la base por debajo del techo, y selecciona mm, cm o m.',
  'load.validationPreview': 'Proyecto abierto en modo consulta por problemas de región o máscara. Los cambios son temporales. La exportación conserva los datos originales.',
  'load.regionWarning': 'La región de análisis guardada no es válida. Se muestra la imagen completa y se omiten los resultados de esta sección.',
  'load.maskWarning': 'La máscara hace referencia a trazas o solapamientos no válidos. Se omiten las trazas y los resultados de esta sección.',
  'load.failed': 'No se ha podido abrir el proyecto: {e}. No se ha guardado nada encima de la copia guardada.',
  'load.badMask': 'la máscara «{k}» de la sección «{s}» está dañada',
  'load.newer': 'Este proyecto se guardó con una versión más nueva ({v}). Se abre solo para consultar: los cambios no se guardarán. Actualiza SedCoreTool para editarlo.',
  'bk.previous': 'anterior', 'err.generic': 'Error: {e}',
  'quota.use': 'Almacenamiento del navegador: {u} MB de {q} MB ({p} %)', 'quota.high': 'El almacenamiento del navegador está al {p} %. Exporta o borra proyectos que no uses para evitar perder cambios.',
});
Object.assign(D.en, {
  'fig.keepRatio': 'Keep the photo proportions', 'fig.ratioNote': 'Core height/width: {r}', 'geo.cancel': 'Cancel',
  'sec.depthWarning': 'Check this section’s depths before using its results. Enter numeric depths with the bottom greater than the top, and select mm, cm or m.',
  'load.validationPreview': 'Project opened for inspection because of region or mask issues. Changes are temporary. Export keeps the original data.',
  'load.regionWarning': 'The saved analysis region is invalid. The full image is shown and this section’s results are omitted.',
  'load.maskWarning': 'The mask refers to invalid traces or overlaps. This section’s traces and results are omitted.',
  'load.failed': 'The project could not be opened: {e}. Nothing was saved over the stored copy.',
  'load.badMask': 'the «{k}» mask of section «{s}» is damaged',
  'load.newer': 'This project was saved with a newer version ({v}). It opens read-only: changes will not be saved. Update SedCoreTool to edit it.',
  'bk.previous': 'previous', 'err.generic': 'Error: {e}',
  'quota.use': 'Browser storage: {u} MB of {q} MB ({p} %)', 'quota.high': 'Browser storage is {p} % full. Export or delete projects you do not use to avoid losing changes.',
});

// V0.37
Object.assign(D.es, { 'age.baconPasted': '⚠ Parece una tabla de Bacon pegada tal cual (profundidad en cm y edades en años cal BP): ábrela con el botón de archivo para convertir unidades.' });
Object.assign(D.en, { 'age.baconPasted': '⚠ This looks like a Bacon table pasted as is (depth in cm, ages in cal yr BP): open it with the file button to convert units.' });
Object.assign(D.es, {
  'ml.cvGroup': 'Dejar fuera', 'ml.cvGroup.section': 'Sección', 'ml.cvGroup.core': 'Sondeo',
  'ml.scheme.groups': 'Esquema: {f} pliegues por {u} ({g} grupos); las trazas de un mismo grupo nunca están a la vez en entrenamiento y prueba.',
  'ml.scheme.logo': 'Esquema: dejar fuera una {u} cada vez ({g} grupos, {f} pliegues).',
  'ml.scheme.examples': '⚠ Solo hay un grupo: se dejan fuera trazas sueltas de la misma {u}, que se parecen a las de entrenamiento. El acierto será muy optimista.',
  'ml.optimistic': 'El acierto mostrado es optimista: es la misma evaluación que elige el método; confírmalo con un sondeo reservado que no se use para elegir.',
});
Object.assign(D.en, {
  'ml.cvGroup': 'Leave out', 'ml.cvGroup.section': 'Section', 'ml.cvGroup.core': 'Core',
  'ml.scheme.groups': 'Scheme: {f} folds by {u} ({g} groups); traces of one group are never in training and test at once.',
  'ml.scheme.logo': 'Scheme: leave one {u} out at a time ({g} groups, {f} folds).',
  'ml.scheme.examples': '⚠ There is a single group: single traces of the same {u} are left out, and they resemble the training ones. Accuracy will be very optimistic.',
  'ml.optimistic': 'The accuracy shown is optimistic: the same evaluation picks the method; confirm it on a held-out core not used for the choice.',
});
Object.assign(D.es, { 'f.rankNoGain': 'Ningún realce supera con claridad a la imagen sin realce: se deja sin realce.' });
Object.assign(D.en, { 'f.rankNoGain': 'No enhancement clearly beats the image without enhancement: none is applied.' });
// V0.38
Object.assign(D.es, { 'bk.leftOut': 'La copia o el paquete de «{p}» no incluye sus {n} secciones grandes por piezas ({s}): sus máscaras están solo en este ordenador. Se nombran en el archivo («left_out»).' });
Object.assign(D.en, { 'bk.leftOut': 'The copy or package of «{p}» does not include its {n} large tiled sections ({s}): their masks are only on this computer. They are named in the file ("left_out").' });
Object.assign(D.es, { 'mp.joined': '«{c}»: {v} tablas convertidas a las unidades del primer proyecto; {n} valores distintos en la misma profundidad (se conserva el del primero).' });
Object.assign(D.en, { 'mp.joined': '«{c}»: {v} tables converted to the units of the first project; {n} different values at the same depth (the first one is kept).' });
Object.assign(D.es, { 'sec.unitAsk': '¿Convertir las profundidades de la sección? Aceptar: {a}–{b} {u} pasan a ser {c}–{d} {v} (la misma posición). Cancelar: solo se corrige la unidad, y la sección queda en {a}–{b} {v}.' });
Object.assign(D.en, { 'sec.unitAsk': 'Convert the section\'s depths? OK: {a}–{b} {u} become {c}–{d} {v} (the same position). Cancel: only the unit is corrected, and the section is at {a}–{b} {v}.' });
Object.assign(D.es, { 'rec.unit': 'Unidad de esa columna', 'rec.outside': 'El registro, leído en {u} y convertido a {t}, queda fuera de las profundidades o edades del sondeo: comprueba la unidad.' });
Object.assign(D.en, { 'rec.unit': 'Unit of that column', 'rec.outside': 'The record, read in {u} and converted to {t}, lies outside the core\'s depths or ages: check the unit.' });
Object.assign(D.es, { 'imp.justAdded': 'Recién importado.', 'imp.undo': 'Deshacer importación', 'imp.report': 'Cómo se ha leído el archivo', 'imp.clean': 'Se ha leído sin cambiar nada.', 'imp.sheet': 'Hoja', 'imp.sheetOf': 'se lee la hoja «{s}» de {n}', 'imp.censoredRule': 'Valores bajo el límite de detección', 'imp.rule.empty': 'vacíos', 'imp.rule.half': 'la mitad del límite', 'imp.rule.limit': 'el límite', 'imp.censored.empty': '{n} valores por debajo del límite de detección («<0,01», «bdl», «n.d.») se leen como vacíos', 'imp.censored.half': '{n} valores por debajo del límite de detección se leen como la mitad del límite indicado (los que no indican límite, vacíos)', 'imp.censored.limit': '{n} valores por debajo del límite de detección se leen como el límite indicado (los que no lo indican, vacíos)', 'imp.previewNote': 'Primeras {n} de {m} filas tal como se han leído; — es una celda con texto leída como vacía.' });
Object.assign(D.en, { 'imp.justAdded': 'Just imported.', 'imp.undo': 'Undo import', 'imp.report': 'How the file was read', 'imp.clean': 'Read without changing anything.', 'imp.sheet': 'Sheet', 'imp.sheetOf': 'sheet «{s}» of {n} is read', 'imp.censoredRule': 'Values below the detection limit', 'imp.rule.empty': 'empty', 'imp.rule.half': 'half the limit', 'imp.rule.limit': 'the limit', 'imp.censored.empty': '{n} values below the detection limit ("<0.01", "bdl", "n.d.") are read as empty', 'imp.censored.half': '{n} values below the detection limit are read as half the stated limit (those without a limit, empty)', 'imp.censored.limit': '{n} values below the detection limit are read as the stated limit (those without one, empty)', 'imp.previewNote': 'First {n} of {m} rows as read; — is a cell with text read as empty.' });
Object.assign(D.es, { 'imp.sheets': 'el libro tiene {n} hojas y se ha leído la primera', 'imp.preamble': 'se han saltado {n} líneas antes de la tabla', 'imp.missing': '{n} celdas con un código de valor ausente (-999, -999.25 o -9999) se leen como vacías', 'imp.censored': '{n} valores por debajo del límite de detección («<0,01», «bdl», «n.d.») se leen como vacíos', 'imp.ambiguous': 'en {c} no se sabe si «1,250» es 1,25 o 1250: se ha leído como 1,25; compruébalo', 'imp.renamed': 'columnas con el mismo nombre renombradas: {c}', 'imp.long': '{r} filas tienen más columnas que la cabecera; las de más se ignoran' });
Object.assign(D.en, { 'imp.sheets': 'the workbook has {n} sheets and the first was read', 'imp.preamble': '{n} lines before the table were skipped', 'imp.missing': '{n} cells with a missing-value code (-999, -999.25 or -9999) are read as empty', 'imp.censored': '{n} values below the detection limit ("<0.01", "bdl", "n.d.") are read as empty', 'imp.ambiguous': 'in {c} it is unclear whether "1,250" means 1.25 or 1250: read as 1.25; please check', 'imp.renamed': 'columns with the same name renamed: {c}', 'imp.long': '{r} rows have more columns than the header; the extra ones are ignored' });
Object.assign(D.es, { 'imp.dropped': '{n} celdas con texto en columnas numéricas se leen como vacías ({c})', 'imp.short': '{r} filas tienen menos columnas que la cabecera' });
Object.assign(D.en, { 'imp.dropped': '{n} text cells in numeric columns are read as empty ({c})', 'imp.short': '{r} rows have fewer columns than the header' });
Object.assign(D.es, {
  'vis.shaExpected': 'El modelo de visión descargado no coincide con el esperado (SHA-256): los vectores pueden no ser comparables con los publicados.',
  'vis.shaDiff': 'Este modelo de visión (SHA-256 {b}…) no es el que se usó en el proyecto ({a}…): los vectores ya calculados no son comparables; recalcúlalos o carga el archivo original.',
  'map.netAsk': 'Los fondos de mapa se descargan de Esri (ArcGIS Online) o GEBCO: se envía a esos servidores la extensión del mapa (la zona de estudio). Los datos de los sondeos no salen del ordenador. ¿Continuar?',
});
Object.assign(D.en, {
  'vis.shaExpected': 'The downloaded vision model does not match the expected one (SHA-256): vectors may not be comparable with published ones.',
  'vis.shaDiff': 'This vision model (SHA-256 {b}…) is not the one used in the project ({a}…): vectors already computed are not comparable; recompute them or load the original file.',
  'map.netAsk': 'Map backgrounds are downloaded from Esri (ArcGIS Online) or GEBCO: the map extent (the study area) is sent to those servers. Core data never leave the computer. Continue?',
});
Object.assign(D.es, { 'bk.old': 'La copia automática en carpeta no se hace desde hace {d} días y hay cambios: reactívala en Copias de seguridad.' });
Object.assign(D.en, { 'bk.old': 'The automatic folder copy has not run for {d} days and there are changes: reactivate it in Backups.' });
Object.assign(D.es, { 'a11y.core': 'Sondeo', 'a11y.color': 'Color', 'a11y.name': 'Nombre', 'a11y.delete': 'Borrar', 'brand.tip': 'SedCoreTool (antes SedCoreTool e IchAnTool)', 'a11y.keys': 'Atajos de una tecla', 'a11y.keysOn': 'Activados', 'a11y.keysOff': 'Desactivados (solo con Ctrl/⌘ o desde los botones)', 'a11y.keysNote': 'Los atajos de una sola tecla (B, E, S…) pueden interferir con lectores de pantalla o control por voz (WCAG 2.1.4).' });
Object.assign(D.en, { 'a11y.core': 'Core', 'a11y.color': 'Colour', 'a11y.name': 'Name', 'a11y.delete': 'Delete', 'brand.tip': 'SedCoreTool (formerly SedCoreTool and IchAnTool)', 'a11y.keys': 'Single-key shortcuts', 'a11y.keysOn': 'On', 'a11y.keysOff': 'Off (only with Ctrl/⌘ or from the buttons)', 'a11y.keysNote': 'Single-key shortcuts (B, E, S…) may interfere with screen readers or voice control (WCAG 2.1.4).' });
// V0.43: core location map
Object.assign(D.es, {
  'fig.t.locmap': 'Mapa de localización de sondeos',
  'lm.intro': 'Sondeos del proyecto con coordenadas: {n} (lat/lon en la ficha de cada sondeo).', 'lm.noCores': 'Ningún sondeo tiene coordenadas: añádelas en la ficha del sondeo (✎).',
  'lm.view': 'Vista y capas', 'lm.base': 'Mapa base', 'lm.baseOpacity': 'Opacidad del fondo',
  'lm.b.blank': 'En blanco', 'lm.b.vector': 'Vectorial (tierra y mar, sin internet)', 'lm.b.satellite': 'Satélite (Esri)', 'lm.b.topo': 'Topográfico (Esri)', 'lm.b.relief': 'Relieve sombreado (Esri)', 'lm.b.physical': 'Físico (Esri)', 'lm.b.streets': 'Callejero (Esri)', 'lm.b.ocean': 'Océano y batimetría (Esri)',
  'lm.bb.W': 'Oeste (lon)', 'lm.bb.S': 'Sur (lat)', 'lm.bb.E': 'Este (lon)', 'lm.bb.N': 'Norte (lat)',
  'lm.z.in': 'Acercar', 'lm.z.out': 'Alejar', 'lm.z.w': 'Mover al oeste', 'lm.z.n': 'Mover al norte', 'lm.z.s': 'Mover al sur', 'lm.z.e': 'Mover al este', 'lm.z.fit': 'Ajustar a los sondeos',
  'lm.width': 'Ancho (px)', 'lm.aspect': 'Proporción', 'lm.aspectAuto': 'La del encuadre',
  'lm.crsT': 'Sistema de referencia', 'lm.crs': 'Proyección', 'lm.c.EPSG4326': 'WGS 84 geográficas (EPSG:4326)', 'lm.c.EPSG3857': 'Web Mercator (EPSG:3857)', 'lm.c.UTM': 'UTM WGS 84 (EPSG:326xx/327xx)',
  'lm.zone': 'Huso UTM', 'lm.zoneAuto': 'Automático ({z})', 'lm.hemi': 'Hemisferio', 'lm.hemiAuto': 'Automático', 'lm.hN': 'Norte', 'lm.hS': 'Sur',
  'lm.gridT': 'Cuadrícula y coordenadas', 'lm.grid': 'Mostrar cuadrícula', 'lm.gridType': 'Cuadrícula', 'lm.g.auto': 'Automática (lat/lon en geográficas, métrica en proyectadas)', 'lm.g.geo': 'Lat/lon (curvas en UTM)',
  'lm.stepDeg': 'Intervalo (°)', 'lm.stepM': 'Intervalo (m)', 'lm.sides': 'Coordenadas en los lados',
  'lm.side.top': 'Arriba', 'lm.side.bottom': 'Abajo', 'lm.side.left': 'Izquierda', 'lm.side.right': 'Derecha',
  'lm.fmt': 'Formato', 'lm.f.dd': 'Grados decimales (DD)', 'lm.f.dms': 'Grados, minutos y segundos (DMS)', 'lm.unit': 'Unidad', 'lm.metricNote': 'Proyección métrica: las etiquetas son X (arriba/abajo) e Y (izquierda/derecha) en metros.',
  'lm.labelSize': 'Tamaño de las etiquetas', 'lm.gridColor': 'Color de la cuadrícula', 'lm.ticks': 'Marcas en el marco', 'lm.rotateSide': 'Etiquetas laterales en vertical', 'lm.gridDash': 'Cuadrícula discontinua',
  'lm.elemT': 'Escala y norte', 'lm.scaleBar': 'Barra de escala', 'lm.north': 'Flecha de norte', 'lm.northSize': 'Tamaño del norte', 'lm.pos': 'Posición',
  'lm.pos.tl': 'Arriba izquierda', 'lm.pos.tr': 'Arriba derecha', 'lm.pos.bl': 'Abajo izquierda', 'lm.pos.br': 'Abajo derecha',
  'lm.coresT': 'Sondeos y colores', 'lm.symbol': 'Símbolo', 'lm.s.circle': 'Círculo', 'lm.s.square': 'Cuadrado', 'lm.s.triangle': 'Triángulo', 'lm.s.diamond': 'Rombo', 'lm.s.star': 'Estrella',
  'lm.pointSize': 'Tamaño del símbolo', 'lm.pointColor': 'Color del símbolo', 'lm.land': 'Tierra', 'lm.sea': 'Mar', 'lm.coreLabelSize': 'Tamaño de los nombres', 'lm.coreLabels': 'Nombres de los sondeos', 'lm.coast': 'Línea de costa sobre el fondo',
  'lm.outT': 'Salida', 'lm.fmtOut': 'Formato', 'lm.scale': 'Resolución (PNG/JPEG)', 'lm.export': 'Exportar mapa',
});
Object.assign(D.en, {
  'fig.t.locmap': 'Core location map',
  'lm.intro': 'Project cores with coordinates: {n} (lat/lon in each core card).', 'lm.noCores': 'No core has coordinates: add them in the core card (✎).',
  'lm.view': 'View and layers', 'lm.base': 'Base map', 'lm.baseOpacity': 'Background opacity',
  'lm.b.blank': 'Blank', 'lm.b.vector': 'Vector (land and sea, offline)', 'lm.b.satellite': 'Satellite (Esri)', 'lm.b.topo': 'Topographic (Esri)', 'lm.b.relief': 'Shaded relief (Esri)', 'lm.b.physical': 'Physical (Esri)', 'lm.b.streets': 'Streets (Esri)', 'lm.b.ocean': 'Ocean and bathymetry (Esri)',
  'lm.bb.W': 'West (lon)', 'lm.bb.S': 'South (lat)', 'lm.bb.E': 'East (lon)', 'lm.bb.N': 'North (lat)',
  'lm.z.in': 'Zoom in', 'lm.z.out': 'Zoom out', 'lm.z.w': 'Move west', 'lm.z.n': 'Move north', 'lm.z.s': 'Move south', 'lm.z.e': 'Move east', 'lm.z.fit': 'Fit to cores',
  'lm.width': 'Width (px)', 'lm.aspect': 'Aspect ratio', 'lm.aspectAuto': 'From the extent',
  'lm.crsT': 'Reference system', 'lm.crs': 'Projection', 'lm.c.EPSG4326': 'WGS 84 geographic (EPSG:4326)', 'lm.c.EPSG3857': 'Web Mercator (EPSG:3857)', 'lm.c.UTM': 'UTM WGS 84 (EPSG:326xx/327xx)',
  'lm.zone': 'UTM zone', 'lm.zoneAuto': 'Automatic ({z})', 'lm.hemi': 'Hemisphere', 'lm.hemiAuto': 'Automatic', 'lm.hN': 'North', 'lm.hS': 'South',
  'lm.gridT': 'Grid and coordinates', 'lm.grid': 'Show grid', 'lm.gridType': 'Grid', 'lm.g.auto': 'Automatic (lat/lon in geographic, metric in projected)', 'lm.g.geo': 'Lat/lon (curved in UTM)',
  'lm.stepDeg': 'Interval (°)', 'lm.stepM': 'Interval (m)', 'lm.sides': 'Coordinates on the sides',
  'lm.side.top': 'Top', 'lm.side.bottom': 'Bottom', 'lm.side.left': 'Left', 'lm.side.right': 'Right',
  'lm.fmt': 'Format', 'lm.f.dd': 'Decimal degrees (DD)', 'lm.f.dms': 'Degrees, minutes, seconds (DMS)', 'lm.unit': 'Unit', 'lm.metricNote': 'Metric projection: labels are X (top/bottom) and Y (left/right) in metres.',
  'lm.labelSize': 'Label size', 'lm.gridColor': 'Grid colour', 'lm.ticks': 'Ticks on the frame', 'lm.rotateSide': 'Vertical side labels', 'lm.gridDash': 'Dashed grid',
  'lm.elemT': 'Scale and north', 'lm.scaleBar': 'Scale bar', 'lm.north': 'North arrow', 'lm.northSize': 'North arrow size', 'lm.pos': 'Position',
  'lm.pos.tl': 'Top left', 'lm.pos.tr': 'Top right', 'lm.pos.bl': 'Bottom left', 'lm.pos.br': 'Bottom right',
  'lm.coresT': 'Cores and colours', 'lm.symbol': 'Symbol', 'lm.s.circle': 'Circle', 'lm.s.square': 'Square', 'lm.s.triangle': 'Triangle', 'lm.s.diamond': 'Diamond', 'lm.s.star': 'Star',
  'lm.pointSize': 'Symbol size', 'lm.pointColor': 'Symbol colour', 'lm.land': 'Land', 'lm.sea': 'Sea', 'lm.coreLabelSize': 'Name size', 'lm.coreLabels': 'Core names', 'lm.coast': 'Coastline over the background',
  'lm.outT': 'Output', 'lm.fmtOut': 'Format', 'lm.scale': 'Resolution (PNG/JPEG)', 'lm.export': 'Export map',
});
// V0.49: final test on reserved cores
Object.assign(D.es, {
  'ft.title': 'Prueba final con sondeos reservados', 'ft.intro': 'Los sondeos marcados no entrenan ni intervienen al elegir modelos. Mientras haya sondeos reservados, se excluyen los ejemplos de biblioteca y de otros proyectos que puedan proceder de ellos: mismo sondeo (identificador o nombre) o descriptores idénticos a una traza reservada. La prueba final debe usarse una sola vez.',
  'ft.run': 'Hacer la prueba final', 'ft.ichnoHint': 'Predice con el modelo en uso las trazas identificadas de los sondeos reservados.',
  'ft.confirm': 'La prueba final solo es independiente si no cambias el modelo después de ver su resultado. Cada repetición queda registrada. ¿Hacerla ahora?',
  'ft.none': 'Todavía no hay pruebas finales.', 'ft.when': 'Fecha', 'ft.what': 'Modelo y sondeos reservados',
  'ft.repeat': 'Es la {n}.ª prueba final de este objetivo: si has cambiado el modelo tras ver la anterior, ya no es independiente (queda anotado).', 'ft.repeatTip': 'Prueba repetida: deja de ser independiente si el modelo se cambió tras ver la anterior.',
  'ft.noCores': 'Marca antes al menos un sondeo como reservado.', 'ft.noTraces': 'Los sondeos reservados no tienen trazas identificadas o no hay modelo entrenado.',
  'ft.reserved': '«{c}» reservado para la prueba final: ya no entrena ni interviene al elegir el modelo.', 'ft.released': '«{c}» vuelve a usarse para entrenar.',
});
Object.assign(D.en, {
  'ft.title': 'Final test on reserved cores', 'ft.intro': 'Marked cores do not train or select models. While cores are reserved, library and other-project examples that may come from them are excluded: same core (identifier or name) or descriptors identical to a reserved trace. Use the final test only once.',
  'ft.run': 'Run the final test', 'ft.ichnoHint': 'Predicts the identified traces of the reserved cores with the model in use.',
  'ft.confirm': 'The final test is independent only if you do not change the model after seeing its result. Every repetition is logged. Run it now?',
  'ft.none': 'No final tests yet.', 'ft.when': 'Date', 'ft.what': 'Model and reserved cores',
  'ft.repeat': 'This is final test no. {n} for this target: if you changed the model after seeing the previous one, it is no longer independent (logged).', 'ft.repeatTip': 'Repeated test: no longer independent if the model was changed after seeing the previous one.',
  'ft.noCores': 'Mark at least one core as reserved first.', 'ft.noTraces': 'The reserved cores have no identified traces or no model is trained.',
  'ft.reserved': '«{c}» reserved for the final test: it no longer trains nor takes part in choosing the model.', 'ft.released': '«{c}» is used for training again.',
});
Object.assign(D.es, { 'ft.retrain': 'El clasificador se entrenó con otra reserva de sondeos: vuelve a entrenarlo antes de la prueba final.' });
Object.assign(D.en, { 'ft.retrain': 'The classifier was trained with another core reservation: retrain it before the final test.' });
// V0.51: figures
Object.assign(D.es, {
  'fig.orient': 'Orientación', 'fig.orient.v': 'Vertical (profundidad o edad hacia abajo)', 'fig.orient.h': 'Horizontal (profundidad o edad hacia la derecha)',
  'fig.rangeColW': 'Ancho de cada icnotaxón (px)', 'fig.rangeTaxa': 'Icnotaxones mostrados',
  'fig.rangeDisplay.kite': 'Abundancia en curvas simétricas', 'fig.rangeDisplay.kiteSymbols': 'Curvas simétricas y símbolos',
  'fig.rangeSubKite': 'Abundancia de cada icnotaxón (% del área) como curvas simétricas', 'fig.rangeSubKiteSym': 'Abundancia en curvas simétricas y trazas identificadas',
});
Object.assign(D.en, {
  'fig.orient': 'Orientation', 'fig.orient.v': 'Vertical (depth or age downwards)', 'fig.orient.h': 'Horizontal (depth or age to the right)',
  'fig.rangeColW': 'Width of each ichnotaxon (px)', 'fig.rangeTaxa': 'Ichnotaxa shown',
  'fig.rangeDisplay.kite': 'Abundance as symmetric curves', 'fig.rangeDisplay.kiteSymbols': 'Symmetric curves and symbols',
  'fig.rangeSubKite': 'Abundance of each ichnotaxon (% of area) as symmetric curves', 'fig.rangeSubKiteSym': 'Abundance as symmetric curves and identified traces',
});

Object.assign(D.es, {
  'color.title': 'Colores', 'color.barColor': 'Barras de bioturbación', 'color.lineColor': 'Línea de bioturbación',
  'color.biColor': 'Barras de BI', 'color.iiColor': 'Barras de ii', 'color.manualColor': 'Índice manual',
  'color.textColor': 'Textos y ejes', 'color.subColor': 'Subtítulo y marcas de escala', 'color.frameColor': 'Marcos',
  'color.gridColor': 'Cuadrícula', 'color.boundaryColor': 'Límites de sección', 'color.bgColor': 'Fondo',
  'color.reset': 'Colores por defecto', 'color.marks': 'Marcas a mano (triángulos)',
  'color.note': 'Los colores de cada icnotaxón se cambian en Icnotaxones, los de los registros en su lista de Columna del sondeo y los de las categorías de intervalos en Multiproxy.',
});
Object.assign(D.en, {
  'color.title': 'Colours', 'color.barColor': 'Bioturbation bars', 'color.lineColor': 'Bioturbation line',
  'color.biColor': 'BI bars', 'color.iiColor': 'ii bars', 'color.manualColor': 'Manual index',
  'color.textColor': 'Text and axes', 'color.subColor': 'Subtitle and scale ticks', 'color.frameColor': 'Frames',
  'color.gridColor': 'Grid', 'color.boundaryColor': 'Section boundaries', 'color.bgColor': 'Background',
  'color.reset': 'Default colours', 'color.marks': 'Hand-placed marks (triangles)',
  'color.note': 'Change ichnotaxon colours in Ichnotaxa, record colours in the Core column record list, and interval category colours in Multiproxy.',
});
// V0.57: closing the desktop program when the changes could not be saved
Object.assign(D.es, {
  'close.failTitle': 'No se han podido guardar los últimos cambios', 'close.failText': 'Si cierras ahora se perderán. Puedes reintentar, exportar el proyecto a un archivo .sedcoretool o cerrar sin guardar.',
  'close.noStorage': 'El almacenamiento del programa no está disponible.', 'close.retry': 'Reintentar', 'close.export': 'Exportar proyecto',
  'close.discard': 'Cerrar sin guardar', 'close.exported': 'Proyecto exportado. Ya puedes cerrar sin guardar.', 'close.exportFail': 'No se pudo exportar el proyecto.',
});
Object.assign(D.en, {
  'close.failTitle': 'The latest changes could not be saved', 'close.failText': 'Closing now will lose them. You can retry, export the project to a .sedcoretool file, or close without saving.',
  'close.noStorage': 'The program storage is not available.', 'close.retry': 'Retry', 'close.export': 'Export project',
  'close.discard': 'Close without saving', 'close.exported': 'Project exported. You can now close without saving.', 'close.exportFail': 'The project could not be exported.',
});
// V0.58: final test exclusions and age model checks
Object.assign(D.es, {
  'ft.dropped': '{n} ejemplos externos excluidos por poder proceder de un sondeo reservado.',
  'age.dupDepth': '⚠ La profundidad {d} tiene dos edades distintas. Para un hiato, escribe dos profundidades separadas por una distancia pequeña.',
  'age.rangeIgnored': '⚠ Rango de edad ignorado: {n} filas tienen el mínimo o el máximo vacío o no contienen la edad.',
});
Object.assign(D.en, {
  'ft.dropped': '{n} external examples excluded because they may come from a reserved core.',
  'age.dupDepth': '⚠ Depth {d} has two different ages. For a hiatus, write two depths a small distance apart.',
  'age.rangeIgnored': '⚠ Age range ignored: {n} rows have a blank minimum or maximum or do not contain the age.',
});

// V0.67: the save indicator says where the data are when there is no backup folder
Object.assign(D.es, { 'save.local': 'Guardado en este equipo · sin copia en carpeta', 'save.localPending': 'Guardado en este equipo · copia en carpeta pendiente', 'save.localTip': 'Los datos están en el almacenamiento interno del programa, no en una carpeta tuya. Elige una carpeta en Copias de seguridad para tener una copia fuera de él.' });
Object.assign(D.en, { 'save.local': 'Saved on this computer · no folder backup', 'save.localPending': 'Saved on this computer · folder backup pending', 'save.localTip': 'The data are in the program\'s internal storage, not in a folder of yours. Choose a folder under Backups to keep a copy outside it.' });

// V0.69: ruler-style vertical scale
Object.assign(D.es, { 'st.yStep': 'Número de profundidad cada', 'st.yDiv': 'o nº aproximado de números', 'st.yMajor': 'Marca larga cada', 'st.yMedium': 'Marca mediana cada', 'st.yMinor': 'Marca pequeña cada',
  'st.yLabelLen': 'Largo de la marca con número (px)', 'st.yMajorLen': 'Largo de la marca larga (px)', 'st.yMediumLen': 'Largo de la marca mediana (px)', 'st.yMinorLen': 'Largo de la marca pequeña (px)', 'st.auto': 'auto',
  'st.tickHelp': 'Intervalos en las unidades del eje. Si una posición coincide con varias marcas, gana la de mayor nivel: número > larga > mediana > pequeña. Regla: pequeña 1, mediana 5, larga 10 y número 10.' });
Object.assign(D.en, { 'st.yStep': 'Depth number every', 'st.yDiv': 'or approx. number of labels', 'st.yMajor': 'Long tick every', 'st.yMedium': 'Medium tick every', 'st.yMinor': 'Short tick every',
  'st.yLabelLen': 'Length of the numbered tick (px)', 'st.yMajorLen': 'Length of the long tick (px)', 'st.yMediumLen': 'Length of the medium tick (px)', 'st.yMinorLen': 'Length of the short tick (px)', 'st.auto': 'auto',
  'st.tickHelp': 'Intervals in axis units. Where several ticks coincide the highest level wins: number > long > medium > short. Ruler: short 1, medium 5, long 10 and number 10.' });

// V0.73: saved versions of a figure as tabs
Object.assign(D.es, { 'fig.tab.add': 'Nueva pestaña: copia de la figura actual, para guardar otra versión', 'fig.tab.del': 'Borrar esta figura guardada', 'fig.tab.delAsk': '¿Borrar esta pestaña con su figura? No se puede deshacer.', 'fig.tab.rename': 'Doble clic para cambiar el nombre' });
Object.assign(D.en, { 'fig.tab.add': 'New tab: a copy of the current figure, to keep another version', 'fig.tab.del': 'Delete this saved figure', 'fig.tab.delAsk': 'Delete this tab and its figure? This cannot be undone.', 'fig.tab.rename': 'Double-click to rename' });

// V0.74: ruler button of the depth scale
Object.assign(D.es, { 'st.ruler': 'Escala tipo regla: marca pequeña cada', 'st.rulerGo': 'Aplicar regla', 'st.rulerTip': 'Rellena: pequeña = el valor, mediana = 5×, número y marca larga = 10×, con largos 3, 5 y 8 px', 'st.rulerNeed': 'Escribe primero cada cuánto va la marca pequeña (mayor que 0).' });
Object.assign(D.en, { 'st.ruler': 'Ruler scale: short tick every', 'st.rulerGo': 'Apply ruler', 'st.rulerTip': 'Fills in: short = the value, medium = 5×, number and long tick = 10×, with lengths 3, 5 and 8 px', 'st.rulerNeed': 'First enter the short tick interval (greater than 0).' });

// V0.76: formula errors, demo core and map credits are translated
Object.assign(D.es, {"fx.noBracket": "falta ]", "fx.noQuote": "falta comilla", "fx.badChar": "carácter no válido: {v}", "fx.expected": "se esperaba {v}", "fx.incomplete": "fórmula incompleta", "fx.unexpected": "no se esperaba {v}", "fx.extra": "sobra {v}", "fx.unkFn": "función desconocida: {v}", "fx.invalid": "fórmula no válida", "fx.colOnly": "COL() solo en celdas", "fx.noCol": "no existe la columna «{v}»", "fx.circular": "referencia circular", "fx.badRef": "referencia no válida: {v}", "fx.noCore": "no existe el sondeo «{v}»", "test.name": "Sondeo de prueba · IODP 397-U1385I-1H", "test.ms": "Susceptibilidad magnética", "test.age": "# Modelo de edad ILUSTRATIVO, no publicado: tasa de sedimentación constante supuesta de 10 cm/ka,\n# solo para probar la conversión a edad. Sustitúyelo por el modelo publicado del sitio U1385.\n# profundidad C...CSF-A (m), edad (ka)\n0, 0\n8.78, 87.8", "map.attr.physical": "Fondo: Esri, U.S. National Park Service (World Physical Map)", "map.attr.relief": "Fondo: Esri (World Shaded Relief)", "map.attr.topo": "Fondo: Esri y colaboradores (World Topographic Map)", "map.attr.bathy": "Fondo: Esri, Garmin, GEBCO, NOAA NGDC y otros (World Ocean Base)", "map.attr.gebco": "Batimetría y topografía: GEBCO Compilation Group, GEBCO_LATEST grid (www.gebco.net)", "map.attr.photo": "Imagen: Esri, Maxar, Earthstar Geographics y GIS User Community (World Imagery)", "map.attr.photobathy": "Batimetría: GEBCO Compilation Group (GEBCO_LATEST); tierra: Esri, Maxar, Earthstar Geographics (World Imagery)"});
Object.assign(D.en, {"fx.noBracket": "missing ]", "fx.noQuote": "missing quote", "fx.badChar": "invalid character: {v}", "fx.expected": "expected {v}", "fx.incomplete": "incomplete formula", "fx.unexpected": "unexpected {v}", "fx.extra": "unexpected trailing {v}", "fx.unkFn": "unknown function: {v}", "fx.invalid": "invalid formula", "fx.colOnly": "COL() only in cells", "fx.noCol": "column «{v}» does not exist", "fx.circular": "circular reference", "fx.badRef": "invalid reference: {v}", "fx.noCore": "core «{v}» does not exist", "test.name": "Test core · IODP 397-U1385I-1H", "test.ms": "Magnetic susceptibility", "test.age": "# ILLUSTRATIVE age model, not published: assumed constant sedimentation rate of 10 cm/ka,\n# only to test the conversion to age. Replace it with the published age model of site U1385.\n# depth C...CSF-A (m), age (ka)\n0, 0\n8.78, 87.8", "map.attr.physical": "Background: Esri, U.S. National Park Service (World Physical Map)", "map.attr.relief": "Background: Esri (World Shaded Relief)", "map.attr.topo": "Background: Esri and contributors (World Topographic Map)", "map.attr.bathy": "Background: Esri, Garmin, GEBCO, NOAA NGDC and others (World Ocean Base)", "map.attr.gebco": "Bathymetry and topography: GEBCO Compilation Group, GEBCO_LATEST grid (www.gebco.net)", "map.attr.photo": "Imagery: Esri, Maxar, Earthstar Geographics and the GIS User Community (World Imagery)", "map.attr.photobathy": "Bathymetry: GEBCO Compilation Group (GEBCO_LATEST); land: Esri, Maxar, Earthstar Geographics (World Imagery)"});

// V0.78: section column
Object.assign(D.es, {"log.secs": "Secciones", "st.secOrient": "Texto de la sección", "st.secV": "Vertical", "st.secH": "Horizontal", "st.secLabel": "Mostrar", "st.secName": "Nombre", "st.secNum": "Número"});
Object.assign(D.en, {"log.secs": "Sections", "st.secOrient": "Section text", "st.secV": "Vertical", "st.secH": "Horizontal", "st.secLabel": "Show", "st.secName": "Name", "st.secNum": "Number"});

Object.assign(D.es, {
  'mp.projects': 'Seleccionar proyectos completos', 'mp.cores': 'Sondeos', 'mp.markers': 'Colores y símbolos por proyecto o sondeo',
  'mp.markerFor': 'Editar marcador de', 'mp.color': 'Color', 'mp.markerReset': 'Restablecer marcador',
  'mp.markerDefault': 'Heredado', 'mp.markerNote': 'Los sondeos heredan el estilo de su proyecto salvo que se personalicen. Los sondeos compartidos se muestran una vez y heredan del primer proyecto por nombre.',
});
Object.assign(D.en, {
  'mp.projects': 'Select entire projects', 'mp.cores': 'Cores', 'mp.markers': 'Colours and symbols by project or core',
  'mp.markerFor': 'Edit marker for', 'mp.color': 'Colour', 'mp.markerReset': 'Reset marker',
  'mp.markerDefault': 'Inherited', 'mp.markerNote': 'Cores inherit their project’s style unless customised. Shared cores appear once and inherit from the first project by name.',
});

// Configurable ichnotaxon abundance and occurrence presentation.
Object.assign(D.es, {
  'taxa.layout': 'Distribución', 'taxa.layout.stack': 'Abundancias apiladas', 'taxa.layout.overlay': 'Superpuestos en una columna', 'taxa.layout.separate': 'Un icnotaxón por columna',
  'taxa.abundance': 'Abundancia (%)', 'taxa.abundance.none': 'No mostrar abundancia', 'taxa.abundance.bars': 'Barras', 'taxa.abundance.line': 'Curvas', 'taxa.abundance.area': 'Áreas rellenas', 'taxa.abundance.kite': 'Curvas simétricas alrededor del eje',
  'taxa.occurrence': 'Presencias', 'taxa.occurrence.none': 'No mostrar presencias', 'taxa.occurrence.symbols': 'Símbolos', 'taxa.occurrence.names': 'Solo nombres', 'taxa.occurrence.both': 'Símbolos y nombres',
  'taxa.source': 'Procedencia de las presencias', 'taxa.source.all': 'Trazas y marcas manuales', 'taxa.source.objects': 'Trazas identificadas', 'taxa.source.marks': 'Solo marcas manuales',
  'taxa.opacity': 'Opacidad del relleno o la curva (%)', 'taxa.scale': 'Escala de abundancia', 'taxa.scale.auto': 'Automática para los datos visibles', 'taxa.scale.percent': '0–100 %',
  'taxa.values': 'Escribir los porcentajes en los intervalos', 'taxa.reset': 'Restablecer representación',
  'taxa.note': 'Las presencias se sitúan en su profundidad o edad. Los porcentajes son los calculados sobre el área válida; una marca de presencia no aporta una abundancia. 100 % de opacidad es opaco. Las etiquetas numéricas necesitan espacio vertical.',
  'taxa.subtitle': 'Abundancia (%) y registros de presencia de icnotaxones',
});
Object.assign(D.en, {
  'taxa.layout': 'Layout', 'taxa.layout.stack': 'Stacked abundances', 'taxa.layout.overlay': 'Overlaid in one column', 'taxa.layout.separate': 'One ichnotaxon per column',
  'taxa.abundance': 'Abundance (%)', 'taxa.abundance.none': 'Hide abundance', 'taxa.abundance.bars': 'Bars', 'taxa.abundance.line': 'Curves', 'taxa.abundance.area': 'Filled areas', 'taxa.abundance.kite': 'Symmetric curves around the axis',
  'taxa.occurrence': 'Occurrences', 'taxa.occurrence.none': 'Hide occurrences', 'taxa.occurrence.symbols': 'Symbols', 'taxa.occurrence.names': 'Names only', 'taxa.occurrence.both': 'Symbols and names',
  'taxa.source': 'Occurrence source', 'taxa.source.all': 'Traces and manual marks', 'taxa.source.objects': 'Identified traces', 'taxa.source.marks': 'Manual marks only',
  'taxa.opacity': 'Fill or curve opacity (%)', 'taxa.scale': 'Abundance scale', 'taxa.scale.auto': 'Automatic for visible data', 'taxa.scale.percent': '0–100 %',
  'taxa.values': 'Label percentages in intervals', 'taxa.reset': 'Reset presentation',
  'taxa.note': 'Occurrences keep their depth or age. Percentages use the measured valid area; a presence mark does not supply an abundance. 100% opacity is opaque. Numeric labels need vertical space.',
  'taxa.subtitle': 'Ichnotaxon abundance (%) and occurrence records',
});
Object.assign(D.es, {
  'engine.pending': 'Calculando con el motor científico…', 'engine.error.ENGINE_UNAVAILABLE': 'El motor científico no está disponible. No se muestran resultados antiguos ni se usa otro cálculo.',
  'engine.error.INVALID_REQUEST': 'El motor rechazó los datos de esta sección', 'engine.error.UNSUPPORTED_INPUT': 'El motor no admite los datos de esta sección', 'engine.error.INVALID_BUFFER': 'El motor perdió los datos enviados; edita la sección para reintentar',
  'engine.error.LIMIT_EXCEEDED': 'La sección supera los límites del motor', 'engine.error.BUSY': 'El motor está ocupado; edita la sección para reintentar', 'engine.error.UNSUPPORTED_METHOD': 'El motor no ofrece este método',
  'engine.error.INTERNAL': 'El motor falló al calcular esta sección',
  'engine.retry': 'Reintentar', 'engine.restarted': 'El motor científico se detuvo y se reinició. Se recalculan las secciones.', 'engine.restartFailed': 'No se pudo reiniciar el motor científico. Las secciones siguen con su error.',
});
Object.assign(D.es, { 'nav.preview': 'Miniatura de navegación optimizada', 'nav.previewTip': 'Activada al iniciar. Desactívala para usar el renderizado anterior durante esta sesión; las figuras y los datos no cambian.' });
Object.assign(D.en, {
  'engine.pending': 'Calculating with the scientific engine…', 'engine.error.ENGINE_UNAVAILABLE': 'The scientific engine is not available. Old results are not shown and no other calculation is used.',
  'engine.error.INVALID_REQUEST': 'The engine rejected the data of this section', 'engine.error.UNSUPPORTED_INPUT': 'The engine does not support the data of this section', 'engine.error.INVALID_BUFFER': 'The engine lost the data it was sent; edit the section to retry',
  'engine.error.LIMIT_EXCEEDED': 'The section exceeds the engine limits', 'engine.error.BUSY': 'The engine is busy; edit the section to retry', 'engine.error.UNSUPPORTED_METHOD': 'The engine does not offer this method',
  'engine.error.INTERNAL': 'The engine failed to calculate this section',
  'engine.retry': 'Retry', 'engine.restarted': 'The scientific engine stopped and was restarted. The sections are being recalculated.', 'engine.restartFailed': 'The scientific engine could not be restarted. The sections keep their error.',
});
Object.assign(D.en, { 'nav.preview': 'Optimised navigation preview', 'nav.previewTip': 'Enabled at startup. Disable it to use the previous renderer for this session; figures and data are unchanged.' });

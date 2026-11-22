"""SedCoreTool (formerly CorAnTool and IchAnTool; import name ``sedcoretool``, old ``ichantool`` still works): quantitative ichnofabric analysis of core images.

Turns segmented core images (bioturbation masks) into continuous
depth (or age) series of bioturbation percentage, per-ichnotaxon
coverage and semi-quantitative indices (BI, ii).
"""

from .indices import BI_TAYLOR_GOLDRING, II_DROSER_BOTTJER, IndexScheme
from .io import load_image, load_mask
from .pipeline import CoreSection, analyze_image, analyze_mask
from .segmentation import mask_from_palette, mask_from_threshold, mask_from_unet

__version__ = "0.153.0"

__all__ = [
    "mask_from_unet",
    "BI_TAYLOR_GOLDRING",
    "II_DROSER_BOTTJER",
    "IndexScheme",
    "CoreSection",
    "analyze_image",
    "analyze_mask",
    "load_image",
    "load_mask",
    "mask_from_palette",
    "mask_from_threshold",
    "__version__",
]

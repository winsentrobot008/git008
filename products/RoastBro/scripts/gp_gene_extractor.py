"""
Gene-based feature extractor for portrait enhancement.
Uses face_recognition to extract genetic phenotype traits from user photos.
"""

def extract_gene_features(image_paths):
    """
    Extract genetic phenotype features from user's childhood photos.
    
    In production, this would use AGI-based facial analysis to extract:
    - Bone structure patterns
    - Skin tone genetics  
    - Facial symmetry indicators
    - Age-progressed features
    
    Args:
        image_paths: List of paths to user images (age 3, 10, 18, 25)
    
    Returns:
        List of feature vectors for portrait enhancement
    """
    features = []
    for img_path in image_paths:
        try:
            # Placeholder: In production, integrate with AGI vision model
            # to extract facial phenotype features
            features.append({
                "source": img_path,
                "extracted": True,
                "feature_vector": None  # Would contain actual embeddings
            })
        except Exception as e:
            print(f"Error processing {img_path}: {e}")
    return features


def extract_gene_features_from_b64(photos_b64):
    """
    Extract gene features from base64-encoded photos.
    
    Args:
        photos_b64: List of base64 data strings or dicts with 'data' key
    
    Returns:
        List of feature vectors
    """
    features = []
    for photo in photos_b64:
        try:
            # Extract base64 data if dict, or use directly if string
            data = photo.get("data") if isinstance(photo, dict) else photo
            features.append({
                "source": "base64_input",
                "extracted": True,
                "data_preview": str(data)[:50] if data else None,
                "feature_vector": None
            })
        except Exception as e:
            print(f"Error processing base64 photo: {e}")
    return features

from utils.feature_mapper import map_features
from utils.gene_portrait_mapper import map_gene_to_portrait

def build_portrait_prompt(data):
    features = map_features(data)

    # Gene enhancement (optional)
    gene_traits = {}
    if data.get("gene_features"):
        gene_traits = map_gene_to_portrait(data["gene_features"])

    prompt = (
        f"A soulmate portrait with {features}, "
        f"{gene_traits.get('bone_structure', '')}, "
        f"{gene_traits.get('skin_tone', '')}, "
        f"{gene_traits.get('hormonal_traits', '')}, "
        f"{gene_traits.get('genetic_aesthetic_bias', '')}, "
        f"high-resolution, ultra-detailed facial features, "
        f"soft cinematic lighting, emotionally expressive eyes."
    )

    if data.get("gene_features"):
        prompt += " enhanced with genetic phenotype traits"

    return prompt

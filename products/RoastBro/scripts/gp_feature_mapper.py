def map_features(data):
    attachment = data.get("attachment_style", "")
    aesthetic = data.get("aesthetic_preference", "")
    emotional = ", ".join(data.get("emotional_needs", []))
    spiritual = data.get("spiritual_tendency", "")
    goals = ", ".join(data.get("life_goals", []))

    features = []

    # 依恋类型 → 面部气质
    if "安全" in attachment:
        features.append("gentle eyes, calm expression, emotionally stable presence")
    elif "焦虑" in attachment:
        features.append("soft but searching gaze, expressive emotional tone")
    elif "回避" in attachment:
        features.append("reserved expression, subtle emotional cues")

    # 审美偏好 → 风格
    if "北欧" in aesthetic:
        features.append("Nordic natural beauty style, cool tones, soft natural lighting")
    elif "日系" in aesthetic:
        features.append("soft pastel tones, warm gentle lighting, delicate features")
    elif "美式" in aesthetic:
        features.append("bold contrast, confident facial structure")

    # 情绪需求 → 气质
    if emotional:
        features.append(f"emotional aura of {emotional}")

    # 心灵倾向 → 能量场
    if "水" in spiritual:
        features.append("fluid, peaceful, introspective aura")
    elif "火" in spiritual:
        features.append("passionate, vibrant, energetic aura")
    elif "土" in spiritual:
        features.append("grounded, stable, nurturing aura")
    elif "风" in spiritual:
        features.append("light, free, imaginative aura")

    # 生活目标 → 场景象征
    if "家庭" in goals:
        features.append("warm, nurturing background atmosphere")
    if "事业" in goals:
        features.append("focused, determined facial tone")

    return ", ".join(features)

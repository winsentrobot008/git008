def generate_portrait_hd(prompt, photos_b64):
    """HD portrait generator with robust fallback for testing.
    Priority:
    1) call generate_image_hd(prompt, photos_b64)
    2) if None or exception, return first uploaded photo base64
    3) else return None
    """
    import logging
    try:
        res = None
        try:
            from utils.image_gen import generate_image_hd
            # pass generation tuning params
            prompt.setdefault('seed', None)
            prompt.setdefault('generation_constraints', prompt.get('generation_constraints', {}))
            prompt['generation_constraints'].update({
              'subject': 'portrait, head and shoulders, realistic human face',
              'orientation': 'vertical',
              'aspect_ratio': '3:4',
              'style': 'photorealistic, natural skin tones, soft cinematic lighting'
            })
            # ensure tuning and prompt_text exist
            prompt.setdefault('tuning', {})
            prompt.setdefault('generation_constraints', {})
            prompt['prompt_text'] = prompt.get('prompt_text') or build_prompt_from_questionnaire(prompt.get('questionnaire', {}))
            res = generate_image_hd(prompt, photos_b64)
        except Exception as e:
            logging.getLogger().warning('[PORTRAIT_SERVICE] generate_image_hd failed: %s', e)
        if res:
            return res
        # fallback to first uploaded photo
        try:
            from utils.image_gen import debug_return_first_photo
            fb = debug_return_first_photo(photos_b64)
            if fb:
                logging.getLogger().info('[PORTRAIT_SERVICE] using first-photo fallback')
                return fb
        except Exception as e:
            logging.getLogger().exception('[PORTRAIT_SERVICE] fallback failed: %s', e)
        return None
    except Exception as e:
        logging.getLogger().exception('[PORTRAIT_SERVICE] unexpected error: %s', e)
        return None


def build_prompt_from_questionnaire(questionnaire):
    # Minimal prompt engine fallback for testing; replace with services/prompt_engine later
    parts = []
    if questionnaire.get('aesthetic_preference'):
        parts.append(questionnaire.get('aesthetic_preference'))
    if questionnaire.get('emotional_needs'):
        parts.append(' '.join(questionnaire.get('emotional_needs')[:3]))
    parts.append('portrait, head and shoulders, photorealistic, soft cinematic lighting')
    parts.append('do not replicate exact photo; synthesize a new portrait inspired by reference')
    return ', '.join(parts)

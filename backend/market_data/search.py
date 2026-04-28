from backend.market_data.symbols import MASTER_SYMBOLS

def search_symbols(query: str, limit: int = 8) -> list[dict]:
    if not query:
        return []
    
    query = query.lower()
    results = []
    
    for asset in MASTER_SYMBOLS:
        if query in asset["symbol"].lower() or query in asset["name"].lower():
            results.append(asset)
            if len(results) >= limit:
                break
                
    return results

def list_assets(asset_type: str | None = None) -> list[dict]:
    if not asset_type:
        return MASTER_SYMBOLS
        
    asset_type = asset_type.lower()
    return [asset for asset in MASTER_SYMBOLS if asset["type"] == asset_type]

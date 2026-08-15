export namespace core {
	
	export class DuplicateGroup {
	    hash: string;
	    files: string[];
	    size: number;
	
	    static createFrom(source: any = {}) {
	        return new DuplicateGroup(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.hash = source["hash"];
	        this.files = source["files"];
	        this.size = source["size"];
	    }
	}

}

export namespace gui {
	
	export class FileEntry {
	    name: string;
	    path: string;
	    isDir: boolean;
	    sizeMB: number;
	    modTime: string;
	    perms: string;
	    previewType: string;
	    mime: string;
	    ext: string;
	    isHidden: boolean;
	
	    static createFrom(source: any = {}) {
	        return new FileEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.isDir = source["isDir"];
	        this.sizeMB = source["sizeMB"];
	        this.modTime = source["modTime"];
	        this.perms = source["perms"];
	        this.previewType = source["previewType"];
	        this.mime = source["mime"];
	        this.ext = source["ext"];
	        this.isHidden = source["isHidden"];
	    }
	}
	export class FlatFile {
	    name: string;
	    extension: string;
	    sizeMB: number;
	    absolutePath: string;
	    relativePath: string;
	    lastModified: string;
	
	    static createFrom(source: any = {}) {
	        return new FlatFile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.extension = source["extension"];
	        this.sizeMB = source["sizeMB"];
	        this.absolutePath = source["absolutePath"];
	        this.relativePath = source["relativePath"];
	        this.lastModified = source["lastModified"];
	    }
	}
	export class PreviewData {
	    text: string;
	
	    static createFrom(source: any = {}) {
	        return new PreviewData(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.text = source["text"];
	    }
	}

}


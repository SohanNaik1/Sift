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


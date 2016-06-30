var siteBackups
siteBackups = (function() {
    function siteBackups() {} ;       
    siteBackups.defaults = {
        fields : {
          sshHost: 'sshHost',
          sshUser: 'sshUser',
          sshPass: 'sshPass',
          sshKey: 'sshKey',
          sshPort: 'sshPort',
          sshRemote: 'sshRemote',
          ftpHost: 'ftpHost',
          ftpUser: 'ftpUser',
          ftpPass: 'ftpPass',
          ftpRemote: 'ftpRemote'            
        },
        logPath: '/media/Dropbox/WebInfoSource/backups/logs/',
        pemPath: '/media/Dropbox/SiteKeys/sitebackup/pem/',
        backupRoot: '/media/sturple/ServerBackups/Websites/',
        archiveRoot: '/media/sturple/ServerBackups/Archives/',
        fileRoot: '/media/Dropbox/WebInfoSource/src/documents/',
        databaseServerRoot: '~/mysql/',
        enables: {
          backup: true,
          database: true,
        },
       config: '/media/Dropbox/WebInfoSource/backups/config.yaml',
       logger: {
            level: 'verbose' /* silly, verbose, info, http, warn, error*/
       }
       
    };
    siteBackups.yamljs = require('yamljs');
    siteBackups.logger = require('npmlog');
    siteBackups.opts = {};
    siteBackups.config = {};
    siteBackups.slug = require('slug');
    siteBackups.emitter = null;
    siteBackups.files = [];
    siteBackups.commands = [];
    siteBackups.rsyncCommands = [];
    siteBackups.postCommands = [];
    siteBackups.startTime = 0;
   // siteBackups.tasks = new siteBackups.TaskGroup();    

    siteBackups.init = function(opts) {
        //setMaxListeners(0);
        var self  = this;
        var figlet = require('figlet');
        var figletText = figlet.textSync("Backups", { font: 'Sweet' });
        this.log(figletText);     
        var configfile = this.defaults.config;       
        var configOpts = {  };
        this.opts = opts;
        this.logger.level = this.defaults.logger.level;
        if (opts.config !== undefined) {
            //configOpts['config'] = opts.config;
            //update config file, as cmd line changed it.
            configfile = this.opts.config;
        }
        
        //setup event listners
        var events = require("events");
        self.emitter = new events.EventEmitter();
        
        // setting up error event
        self.emitter.on('error',function(type,err){
            self.logger.error('Error:: '+type,err);
            
        });
        
        try {
            var yaml =this.yamljs.load(configfile);
            if (yaml instanceof Object) {         
                this.config = this.extend({}, this.defaults, configOpts,yaml );
                this.logger.enableColor();
                this.logger.level = (opts.logging_level !== undefined)  ? opts.logging_level[0] :this.config.logger.level;
                
            } else {
                this.emitter.emit('error', 'config','Not Object '+ configfile);
            }
                          
        } catch(e) {
            this.emitter.emit('error', 'yaml','Parser error '+ configfile + ' e:: '+e);
        }        
       // this.logger.level  = 'verbose'; // used only for debug
       

        
        self.emitter.on('startBackup', function(){
            var d = new Date();
            
            self.logger.verbose('Time',  d.toLocaleDateString() + ' '+ d.toLocaleTimeString() );
            if (self.files.length > 0 ){                
                self.commands = [];
                self.rsyncCommands = [];
                self.postCommands = [];
                self.startTime = d.getTime();
                self.getYaml(self.files.pop());
                
            }
            else {                
                self.emitter.emit('finish');
            }
        });
        
        self.emitter.on('yaml',self.backup);        
        self.emitter.on('finish', function(){
            self.logger.info('**** Finished Backups ****');
            d = new Date();
            var month = d.getMonth()+1;
            
            var filename = self.config.logPath +'backup-'+d.getDate()+'-'+month+'-'+d.getFullYear()+'-'+ d.getTime() +'.log';
            var output = '';
            self.logger.record.forEach(function(v){
               output += v.level+ ' '+ v.prefix + ' ' + v.message  + require('os').EOL;         
            });
            require('fs').writeFile(filename, output, function(err) {
                self.logger.info('Log File', filename, err);
            });
            
        });
        self.emitter.on('rsync',function(data){
            self.logger.warn('Rsync:: ', data);
        });
        self.emitter.on('remoteError',function(err){
            self.logger.error('Remote:: ',err);
        });
        self.emitter.on('yamlError',function(err){
            self.logger.warn('Yaml:: ',err);
            self.emitter.emit('startBackup');
        });
        self.emitter.on('configError',function(err){
            self.logger.warn('Config:: ',err);
            self.emitter.emit('startBackup');
        });        
        self.emitter.on('fileError',function(err){
            self.logger.error('File:: ',err);
        });
        self.emitter.on('errorFatal',function(type, err){
            self.logger.error('Fatal Error '+type, err);
            self.emitter.emit('startBackup');
        });
        /*** doCommands all server side commands **/
        self.emitter.on ('doCommands',function(com, err){
            //this is checking if callback from command or the init.
            if (com !== null) {
                var info = (err.lengtht> 0) ? ' Info:: '+ err : '';
                self.logger.info('doCommand', com +info);
                
            }            
            
            if (self.commands.length > 0 ){
                self.logger.verbose('doCommands doing sshCommand');
                self.sshCommand(self.commands.pop());                
            }
            else {
                self.logger.info('doCommands start Rsync');
                self.emitter.emit('doRsync','','');
                
            }           
        });
        /*** doRsync Copies all server files to local ***/
        self.emitter.on ('doRsync',function(com, err){
            //this is checking if callback from command or the init.
            
           
            if (com.length > 0) {
                var info = (err.length> 0) ? ' Info:: '+ err : '';
                self.logger.info('doRsync', com +info);
            }  
            if (self.rsyncCommands.length > 0 ){
                var command = self.rsyncCommands.pop();                
                self.rsync(command[0],command[1]);                
            }
            else {                
                self.emitter.emit('doPostCommands','','');
            }           
        });

        /** doPostCommands - creates tar and copies files **/
        self.emitter.on ('doPostCommands',function(com, err){
            //this is checking if callback from command or the init.
            if (com.length > 0) {
                var info = (err.length> 0) ? ' Info:: '+ err : '';
                self.logger.info('doPostCommands', com +info);
            }  
            if (self.postCommands.length > 0 ){  self.localCommand(self.postCommands.pop()); }
            else {                
                var d = new Date();
                var time = (d.getTime() - self.startTime) / 1000;
                self.logger.info('*-*-* '+self.yaml.title +' TIME: '+time+'s');
                self.emitter.emit('startBackup');
            }           
        });
        

        this.startBackup();
        return this; 
             
    };
    
    /*
     * determines what type of backup it is single file
     * this simply sets the backup file into this.files, and fires event to start backup
     */
    siteBackups.startBackup = function () {        
        var self = this;        
         // means this is a console command don't send a file
        if (this.opts.field_data !== undefined){    }
        // this is the directory loop logic does all backups
        else {
            // single file
            if (self.opts.input_file !== undefined) {
                self.files.push(this.opts.input_file);
                
                self.emitter.emit('startBackup');
                
            }
            // directory parse
            else {               
                try {
                    require('fs').readdir(self.config.fileRoot,function(err,files){
                       if (err) { self.emitter.emit('fileError',self.config.fileRoot+ ' '+err); }
                       else {
                           files.forEach(function(file){ if (file.indexOf('.md') > 0) {self.files.push( self.config.fileRoot+file);}  });
                       }
                        if (self.files.length === 0) {
                            self.emitter.emit('error','File Root', self.config.fileRoot + ' No files Found');
                        }
                       self.emitter.emit('startBackup');
                       
                   });                   
                }
                catch (e){
                    self.emitter.emit('error','File Root', self.config.fileRoot + ' e:: '+e);
                }

            }
        }

        
        return this;
    };        
    
    siteBackups.backup = function(self,yaml){  
        self.yaml = yaml;
        if (yaml.backup === undefined || yaml.backup.active === undefined) {
            self.emitter.emit('configError', 'BACKUP NOT Defined for '+yaml.title);
            return this;            
        }
        if (yaml.backup.active === true) {           
            var sshflag = ( (yaml[self.config.fields.sshUser] !== undefined) && (yaml[self.config.fields.sshHost] !== undefined) && (yaml[self.config.fields.sshRemote] !== undefined) && (yaml[self.config.fields.sshKey] !== undefined) )
            sshflag = sshflag && (self.opts.no_backup === undefined);
            if (sshflag) {              
                
                self.logger.info('********************************************************');
                self.logger.info('Backing up ', yaml.title);
                self.getCommands();
                self.getRsync();
                self.getPostCommands();
                self.logger.verbose('');
                self.emitter.emit('doCommands', null, null);
            }
            else if (yaml.backup.local) {               
                self.logger.info('********************************************************');
                self.logger.info('Backing up ', yaml.title);                
                self.getRsync();
                self.getPostCommands();
                self.emitter.emit('doRsync', '', '');
            }
            else {
                self.emitter.emit('configError', 'Incomplete SSH settings or NO Backup flag is set ' +yaml.title);
            }
        }
        else {
            
            self.emitter.emit('configError', 'BACKUP NOT Enabled for '+yaml.title);
        }
        return this;
    }
    /*
     * setups up rsync commands
     *
     */
    siteBackups.getRsync = function(){
        var self = this;
        if (self.yaml['backup']['remote'] != undefined) {            
            for (var locations in self.yaml['backup']['remote']) {
                self.rsyncCommands.push([self.yaml['backup']['remote'][locations],'']); 
            }            
        }
        else {
            self.emitter.emit('rsync', 'No File Backup defined ');
        }
        if (self.yaml.database != undefined) {
            self.rsyncCommands.push([self.config.databaseServerRoot,'_database/']);
        }
        else {
            self.emitter.emit('rsync', 'No Database File Backup defined '.self.yaml.title);
        }
    }
    
    /*
     * sets up commands
     *
     */
    siteBackups.getCommands = function(){
        var self = this;
        if (self.yaml.database != undefined) {            
            for (var db in self.yaml.database) {                    
                dbFlag = ( (self.yaml.database[db].name != undefined) && (self.yaml.database[db].user != undefined)  && (self.yaml.database[db].pass != undefined) );                
                if (dbFlag)  {
                    var host = (self.yaml.database[db].host == undefined) ? 'localhost' : self.yaml.database[db].host;
                    self.commands.push('mysqldump -h '+ host + ' -u ' + self.yaml.database[db].user + " -p'" + self.yaml.database[db].pass + "' " + self.yaml.database[db].name + ' > ' + self.config.databaseServerRoot + self.yaml.database[db].name + '.sql');
                }
            }
            self.commands.push('mkdir -p '+ self.config.databaseServerRoot)
        }        
    }
    
    siteBackups.getPostCommands = function() {
        var self = this;
        var backupSlug = self.slug(self.yaml.title);
        
        var d = new Date();
        var dofweek = d.getUTCDay()+1;
        var filename = 'archive-'+backupSlug+'-dofweek-'+ dofweek +'-'+d.getFullYear()+'.tar.gz';
        
        /* copy archive files if 1st and 15th of month */
        if ( (d.getDate() === 1) || (d.getDate() === 15) ) {
            var month = d.getMonth() +1;
            var newfilename = 'archive-'+backupSlug+'-month-'+ month + '('+ d.getDate() +')-' + d.getFullYear()+'.tar.gz';
             self.postCommands.push(['copy',[self.config.archiveRoot  + backupSlug + '/'+filename,self.config.archiveRoot  + backupSlug + '/'+newfilename,{replace : true}]]);
            
            if (self.yaml.database != undefined) {
                self.postCommands.push(['copy',[self.config.archiveRoot  + '_database/' + backupSlug + '/'+filename,self.config.archiveRoot  + '_database/' + backupSlug + '/'+newfilename,{replace : true}]]);
            }
        }                  
                               
        /* tar the contents */
        self.postCommands.push(['targz',self.config.backupRoot  + backupSlug + '/' ,self.config.archiveRoot  + backupSlug + '/'+filename]);
        if (self.yaml.database !== undefined) {
            self.postCommands.push(['targz',self.config.backupRoot  + '_database/' + backupSlug + '/' ,self.config.archiveRoot  + '_database/' + backupSlug + '/'+filename]);
        }
        /* make the archive directories */
        self.postCommands.push(['mkdirp',self.config.archiveRoot  + backupSlug + '/']);
        if (self.yaml.database !== undefined) {
            self.postCommands.push(['mkdirp',self.config.archiveRoot + '_database/' + backupSlug + '/']);
        }
    };



    siteBackups.localCommand = function(command){
        var self = this;
        var targz = require('targz');
        var fs = require('fs.extra');
        var mkdirp = require('mkdirp');
        if (command.length > 0) {
            if (command[0] !== undefined) {                
                if (command[0] == 'mkdirp' && command.length >= 2) {
                    mkdirp(command[1], function (err) {
                        if (err) { self.emitter.emit('error','localCommand',err);  }
                        self.emitter.emit('doPostCommands',command.join(','),'');                                
                    });
                }
                else if (command[0] == 'copy' && command.length >= 2) {                   
                    fs.copy(command[1][0],command[1][1], function(err){
                        if (err) { self.emitter.emit('error','localCommand',err);  }
                        self.emitter.emit('doPostCommands',command.join(','),'');                          
                    });
                }
                else if (command[0] == 'targz' && command.length >= 3) {
                    targz.compress({ src : command[1], dest: command[2],}, function(err){
                        if (err) { self.emitter.emit('error','localCommand',err);  }
                        self.emitter.emit('doPostCommands',command.join(','),'');
                    });
                }
                else if (command[0] == 'warn-log' && command.length >= 2) {
                    
                }
                else {
                    self.emitter.emit('error','localCommand','No Command Found');  
                    self.emitter.emit('doPostCommands',command.join(','),'No Command Found');
                }
            }
        }
        else {
            self.emitter.emit('error','localCommand','Error with Command');  
            self.emitter.emit('doPostCommands',command.join(','),'Error with Command');           
        }
        return this;
    };

    
    siteBackups.sshCommand = function(command){
        var node_ssh = require('node-ssh');
        var ssh  = new node_ssh();
        var self = this;
        execOptions = {
            host: self.yaml[self.config.fields.sshHost],
            username: self.yaml[self.config.fields.sshUser],                        
            privateKey: self.config.pemPath + self.yaml[self.config.fields.sshKey]
        };
        // just setting port if have one.
        if (self.yaml[self.config.fields.sshPort] !== undefined) {
            execOptions['port'] = self.yaml[self.config.fields.sshPort];
        }
        self.logger.verbose('ssh connect with options', execOptions);
      
        ssh.connect(execOptions).then(function(){          
            ssh.execCommand(command).then(function(result){               
                self.emitter.emit('doCommands', command.substr(0, command.indexOf('-p')), result.stderr);
                ssh.end();
            });
       
        },function (error){
            self.logger.error('SSH command failed', error);
            self.emitter.emit('errorFatal','sshCommand', JSON.stringify(error));
        });
        ssh.connection.on('error',function(err){           
            self.emitter.emit('errorFatal','sshCommand', JSON.stringify(err));
        }); 
    };
    

    


    
    siteBackups.rsync = function(src, dest){
        var self = this;
        var rsync = require('rsyncwrapper').rsync;
        
        var backupSlug = self.slug(self.yaml.title);
        var args = [];
        if (self.logger.level == 'verbose'){  args.push('-v');  }     
      
        
        //rsycn options
        var options = {};
        if (self.yaml.backup.local) {
            options = {
                src:  src,
                dest: self.config.backupRoot + dest + backupSlug + '/',                
                args: args,
                ssh: false ,                
                dryrun: (self.opts.dryrun !== undefined),
                recursive: true
            };              
        }
        else {
            options = {
                src: self.yaml[self.config.fields.sshUser] + '@' + self.yaml[self.config.fields.sshHost] + ':' + src,
                dest: self.config.backupRoot + dest + backupSlug + '/',
                
                args: args,
                ssh: true ,
                privateKey: self.config.pemPath + self.yaml[self.config.fields.sshKey],
                dryrun: (self.opts.dryrun !== undefined),
                recursive: true
            };            
        }
        
        // if the port is different than standard.
        if (self.yaml[self.config.fields.sshPort] !== undefined) { options['port'] = self.yaml[self.config.fields.sshPort];   }
       
        //rsync results        
        rsync(options, function(error, stdout, stderr, cmd) {
            if (error !== null) {
                self.emitter.emit('remoteError', stderr );                
            }
            var message = stdout.length > 0 ? stdout : options.src + ' >> ' + options.dest;            
            self.emitter.emit('doRsync', message, '' );
            
            //_this.compressTargz(yaml,dest,isFile);
                
        });
        
    };



    
    //gets yaml portion from a file
    siteBackups.getYaml = function(file) {
        var self = this;        
        var seperator;
        var parser;
        var header;
        var fs   = require('fs');
       // var path = require('path'); 
       
        fs.readFile(file, function(err, data){            
            if (err) {  self.emitter.emit('fileError', 'File read Error '+err);     }
            var  regex = /^\s*[^\n]*?(([^\s\d\w])\2{2,})(?:\x20*([a-z]+))?([\s\S]*?)[^\n]*?\1[^\n]*/;
            var  match = regex.exec(data);
            if (match) {            
                seperator = match[1];
                parser = match[3] || 'yaml';
                header = match[4].trim();
                try {
                    var yaml = self.yamljs.parse(header);
                    if (yaml === undefined) {
                        self.emitter.emit('errorFatal', 'yaml','yaml undefined error ');
                    }else {
                        self.emitter.emit('yaml',self, yaml);
                    }
                    
                } catch(e) {
                   self.emitter.emit('errorFatal', 'Yaml','Parser error '+  ' e:: '+e);
                }
                
                return self;            
            }
            self.emitter.emit('yamlError','Header Could not be Parsed '+ file);
            return self;
        });        

        
        
    };
    
    
    // combines object configurations
    siteBackups.extend = function(target) {
        var sources = [].slice.call(arguments, 1);
        sources.forEach(function (source) {
            for (var prop in source) {
                target[prop] = source[prop];
            }
        });
        return target;        
        
    };
        

    
    siteBackups.log = function(arg,color) {
        //var colors = require('colors');
        if (color !== undefined) {
            console.log(arg[color])  ;  
        }
        else {
           console.log(arg)  ;   
        }
          
        
    };
    
    return siteBackups;
})();


var stdio = require('stdio');
var opts = stdio.getopt({
    /* files and directories */
    'directory'  : { key: 'D', args: 1, description: 'Load all files in directory '},
    'input_file' : {key: 'I', args: 1, description: 'Load single file'},
    'backupRoot' : {key : 'B' , args: 1, description: 'Backup Root /mybackup/directory/'},
    'identity_file' : { key : 'i', args: 1, description: 'identity file'},
    'config' : {key: 'C', args: 1, description: 'config file location default ./config.yaml'},
    /* data with args */
    'title' : {key: 't',  args: 1,description: 'Title or slug used for backup'},    
    'field_data' : {key : 'd', args: 4,  description: 'Field Data ssh (user, host, remote, key) ftp( user, host, remote, password'},
    
    'logging_level' : {key: 'l', args: 1, description: 'Logging level'},

    /* flags */    
    'use_ftp' : {key : 'f', description: 'Use ftp protocal instead of ftp'},
    'no_backup' : {key : 'N', description: 'No backup this could be used to only save database'},
    'db_backup' : {key : 'm' , description: 'Mysql Backup DB'},
    'dryrun' : {key : 'n', description: 'Dry Run nothing will be saved'}
    
    
})

siteBackups.init(opts);

//console.log(siteBackups.logger.record)
